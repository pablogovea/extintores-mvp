const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const supabase = require('./lib/supabaseClient');
const { verificarPassword } = require('./lib/auth');
const { generarQrSvg } = require('./lib/qr');

const app = express();
app.use(express.json({ limit: '10mb' })); // limite mayor por fotos y firmas en base64
// Sesión guardada en una cookie firmada (no en memoria del servidor), para que
// funcione en entornos serverless como Vercel, donde cada petición puede
// atenderla una instancia distinta. La sesión solo guarda datos mínimos del
// usuario (id, nombre, rol), así que cabe de sobra en la cookie.
app.use(cookieSession({
  name: 'extintores_session',
  secret: process.env.SESSION_SECRET || 'extintores-mvp-secret-2026',
  maxAge: 8 * 60 * 60 * 1000, // 8 horas
  httpOnly: true,
  sameSite: 'lax',
}));

const PORT = process.env.PORT || 3000;

// ---------- Utilidades de seguridad y auditoria ----------

function requireAuth(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción.' });
  }
  next();
}

function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.session.usuario) {
      return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción.' });
    }
    if (!rolesPermitidos.includes(req.session.usuario.rol)) {
      return res.status(403).json({ error: `Esta acción requiere rol: ${rolesPermitidos.join(' o ')}.` });
    }
    next();
  };
}

async function registrarAuditoria(usuario, accion, detalle) {
  const { error } = await supabase.from('auditoria').insert({
    usuario_id: usuario ? usuario.id : null,
    usuario_nombre: usuario ? usuario.nombre : 'Desconocido',
    accion,
    detalle: detalle || null,
  });
  if (error) console.error('No se pudo registrar auditoría:', error.message);
}

// ---------- Rutas de autenticación (sin protección) ----------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
  if (!usuario || !verificarPassword(password, usuario.password_hash, usuario.password_salt)) {
    await registrarAuditoria(null, 'Login fallido', `Intento de acceso con usuario "${username}".`);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  req.session.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, iniciales: usuario.iniciales };
  await registrarAuditoria(req.session.usuario, 'Inicio de sesión', null);
  res.json({ usuario: req.session.usuario });
});

app.post('/api/logout', async (req, res) => {
  if (req.session.usuario) await registrarAuditoria(req.session.usuario, 'Cierre de sesión', null);
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ error: 'No hay sesión activa.' });
  res.json({ usuario: req.session.usuario });
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utilidades de negocio ----------

function calcularEstado(extintor) {
  if (extintor.estado_manual) return extintor.estado_manual;

  const hoy = new Date();
  const vencimiento = new Date(extintor.fecha_vencimiento);
  const diasRestantes = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));

  if (diasRestantes < 0) return 'Vencido';
  if (diasRestantes <= 30) return 'Por Vencer';
  return 'Operativo';
}

function diasParaVencer(fechaVencimiento) {
  const hoy = new Date();
  const vencimiento = new Date(fechaVencimiento);
  return Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
}

function enriquecerExtintor(row) {
  return { ...row, estado: calcularEstado(row), dias_restantes: diasParaVencer(row.fecha_vencimiento) };
}

// ---------- Rutas API: inventario ----------

// Listado general — se omite foto_base64 del payload (puede ser pesada),
// pero se conserva qr_svg (unos pocos KB de texto) para la grilla de credenciales.
app.get('/api/extintores', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('extintores')
    .select('*')
    .order('codigo', { ascending: true });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al consultar el inventario.' });
  }

  const resultado = data.map(row => {
    const { foto_base64, ...resto } = row;
    return { ...enriquecerExtintor(resto), tiene_foto: !!foto_base64 };
  });
  res.json(resultado);
});

app.get('/api/extintores/:codigo', requireAuth, async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();

  const { data: row, error } = await supabase
    .from('extintores')
    .select('*')
    .ilike('codigo', codigo)
    .maybeSingle();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al consultar el equipo.' });
  }
  if (!row) {
    return res.status(404).json({ error: `No se encontro ningun extintor con el codigo "${req.params.codigo}".` });
  }

  const { data: inspecciones } = await supabase
    .from('inspecciones')
    .select('*, usuarios ( nombre, iniciales )')
    .eq('extintor_id', row.id)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .limit(5);

  const ultimasInspecciones = (inspecciones || []).map(i => ({
    ...i,
    inspector_nombre: i.usuarios ? i.usuarios.nombre : null,
    inspector_iniciales: i.usuarios ? i.usuarios.iniciales : null,
    usuarios: undefined,
  }));

  res.json({ ...enriquecerExtintor(row), inspecciones: ultimasInspecciones });
});

// Alta de un nuevo extintor — solo Administrador.
// La ubicación ahora es texto libre (ubicacion_nombre / area / piso), sin
// depender de una tabla/lista fija: el usuario la ajusta a sus necesidades.
// Al crear el equipo, el servidor genera su código QR (SVG) y lo guarda
// directamente en la fila, para que quede disponible de inmediato.
app.post('/api/extintores', requireRole('Administrador'), async (req, res) => {
  const {
    codigo, tipo_agente, capacidad,
    ubicacion_nombre, ubicacion_area, ubicacion_piso,
    fecha_recarga, fecha_vencimiento, fecha_prueba_hidrostatica,
    foto_base64,
  } = req.body;

  if (!codigo || !tipo_agente || !capacidad || !ubicacion_nombre || !fecha_recarga || !fecha_vencimiento || !fecha_prueba_hidrostatica) {
    return res.status(400).json({ error: 'Código, agente, capacidad, ubicación y fechas son obligatorios.' });
  }
  if (foto_base64 && foto_base64.length > 4_000_000) {
    return res.status(413).json({ error: 'La foto es demasiado grande. Intenta con una imagen más ligera.' });
  }

  const codigoNormalizado = codigo.trim().toUpperCase();

  const { data: existente } = await supabase.from('extintores').select('id').ilike('codigo', codigoNormalizado).maybeSingle();
  if (existente) {
    return res.status(409).json({ error: `Ya existe un extintor con el código "${codigo}".` });
  }

  let qrSvg = null;
  try {
    qrSvg = await generarQrSvg(codigoNormalizado);
  } catch (err) {
    console.error('No se pudo generar el código QR:', err.message);
  }

  const { data: creado, error } = await supabase
    .from('extintores')
    .insert({
      codigo: codigoNormalizado,
      tipo_agente,
      capacidad,
      ubicacion_nombre: ubicacion_nombre.trim(),
      ubicacion_area: (ubicacion_area || '').trim() || null,
      ubicacion_piso: (ubicacion_piso || '').trim() || null,
      fecha_recarga,
      fecha_vencimiento,
      fecha_prueba_hidrostatica,
      foto_base64: foto_base64 || null,
      qr_svg: qrSvg,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(400).json({ error: 'No se pudo crear el extintor. Verifica los datos enviados.' });
  }

  await registrarAuditoria(req.session.usuario, 'Alta de extintor', `Equipo ${codigoNormalizado} (${tipo_agente}) dado de alta.`);

  const { foto_base64: _omitida, ...creadoLivano } = creado;
  res.status(201).json({ ...enriquecerExtintor(creadoLivano), tiene_foto: !!foto_base64 });
});

// Devuelve el QR de un equipo. Si por alguna razón no se generó al crearlo
// (por ejemplo, equipos migrados desde la versión anterior), lo genera aquí
// mismo y lo guarda, para que quede disponible de forma permanente.
app.get('/api/extintores/:codigo/qr', requireAuth, async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();
  const { data: row, error } = await supabase.from('extintores').select('id, codigo, qr_svg').ilike('codigo', codigo).maybeSingle();

  if (error) return res.status(500).json({ error: 'Error al consultar el equipo.' });
  if (!row) return res.status(404).json({ error: `No se encontro ningun extintor con el codigo "${req.params.codigo}".` });

  if (row.qr_svg) return res.json({ codigo: row.codigo, qr_svg: row.qr_svg });

  try {
    const qrSvg = await generarQrSvg(row.codigo);
    await supabase.from('extintores').update({ qr_svg: qrSvg }).eq('id', row.id);
    res.json({ codigo: row.codigo, qr_svg: qrSvg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar el código QR.' });
  }
});

// Subir o reemplazar la foto de un extintor existente — solo Administrador
app.put('/api/extintores/:codigo/foto', requireRole('Administrador'), async (req, res) => {
  const { foto_base64 } = req.body;
  if (!foto_base64) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
  if (foto_base64.length > 4_000_000) return res.status(413).json({ error: 'La foto es demasiado grande. Intenta con una imagen más ligera.' });

  const codigo = req.params.codigo.trim().toUpperCase();
  const { data: row } = await supabase.from('extintores').select('id').ilike('codigo', codigo).maybeSingle();
  if (!row) return res.status(404).json({ error: `No se encontro ningun extintor con el codigo "${codigo}".` });

  const { error } = await supabase.from('extintores').update({ foto_base64 }).eq('id', row.id);
  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'No se pudo guardar la foto.' });
  }

  await registrarAuditoria(req.session.usuario, 'Foto actualizada', `Se actualizó la fotografía del equipo ${codigo}.`);
  res.json({ ok: true, codigo });
});

// Sugerencias de ubicaciones ya usadas (para autocompletar con <datalist>,
// sin limitar lo que el usuario puede escribir).
app.get('/api/ubicaciones-sugeridas', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('extintores').select('ubicacion_nombre, ubicacion_area, ubicacion_piso');
  if (error) return res.json({ nombres: [], areas: [], pisos: [] });

  const unico = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json({
    nombres: unico(data.map(d => d.ubicacion_nombre)),
    areas: unico(data.map(d => d.ubicacion_area)),
    pisos: unico(data.map(d => d.ubicacion_piso)),
  });
});

app.get('/api/usuarios', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('usuarios').select('id, nombre, rol, iniciales').order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: 'Error al consultar usuarios.' });
  res.json(data);
});

// ---------- Rutas API: inspecciones ----------

app.post('/api/inspecciones', requireAuth, async (req, res) => {
  const { codigo, resultado, presion_ok, precinto_ok, senaletica_ok, observaciones, firma_base64, origen } = req.body;
  const usuario_id = req.session.usuario.id;

  if (!codigo || !resultado) return res.status(400).json({ error: 'Faltan campos obligatorios: codigo y resultado.' });
  if (!['Aprobado', 'Rechazado'].includes(resultado)) return res.status(400).json({ error: 'El resultado debe ser "Aprobado" o "Rechazado".' });

  const { data: extintor, error: errBusqueda } = await supabase.from('extintores').select('*').ilike('codigo', codigo.trim().toUpperCase()).maybeSingle();
  if (errBusqueda) return res.status(500).json({ error: 'Error al consultar el equipo.' });
  if (!extintor) return res.status(404).json({ error: `No se encontro ningun extintor con el codigo "${codigo}".` });

  const fecha = new Date().toISOString().slice(0, 10);

  const { data: inspeccionCreada, error: errInsert } = await supabase
    .from('inspecciones')
    .insert({
      extintor_id: extintor.id,
      usuario_id,
      fecha,
      resultado,
      presion_ok: !!presion_ok,
      precinto_ok: !!precinto_ok,
      senaletica_ok: !!senaletica_ok,
      observaciones: observaciones || null,
      firma_base64: firma_base64 || null,
      origen: origen === 'offline-sync' ? 'offline-sync' : 'online',
    })
    .select()
    .single();

  if (errInsert) {
    console.error(errInsert);
    return res.status(500).json({ error: 'No se pudo registrar la inspección.' });
  }

  let nuevoEstadoManual = extintor.estado_manual;
  if (resultado === 'Rechazado') nuevoEstadoManual = 'Mantenimiento';
  else if (extintor.estado_manual === 'Mantenimiento') nuevoEstadoManual = null;

  const { data: extintorActualizado } = await supabase
    .from('extintores')
    .update({ estado_manual: nuevoEstadoManual })
    .eq('id', extintor.id)
    .select()
    .single();

  await registrarAuditoria(
    req.session.usuario,
    'Inspección registrada',
    `${extintor.codigo} — Resultado: ${resultado}${origen === 'offline-sync' ? ' (sincronizada desde modo offline)' : ''}.`
  );

  const { foto_base64: _omitida, ...extintorLiviano } = extintorActualizado;
  res.status(201).json({
    inspeccion: { ...inspeccionCreada, inspector_nombre: req.session.usuario.nombre },
    extintor: enriquecerExtintor(extintorLiviano),
  });
});

// ---------- Dashboard y notificaciones proactivas ----------

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const { data: rows, error } = await supabase.from('extintores').select('fecha_vencimiento, estado_manual, ubicacion_nombre');
  if (error) return res.status(500).json({ error: 'Error al consultar el inventario.' });

  const enriquecidos = rows.map(enriquecerExtintor);
  const stats = {
    total: enriquecidos.length,
    operativos: enriquecidos.filter(e => e.estado === 'Operativo').length,
    por_vencer: enriquecidos.filter(e => e.estado === 'Por Vencer').length,
    vencidos: enriquecidos.filter(e => e.estado === 'Vencido').length,
    mantenimiento: enriquecidos.filter(e => e.estado === 'Mantenimiento').length,
  };

  const { count: totalInspecciones } = await supabase.from('inspecciones').select('*', { count: 'exact', head: true });
  const { count: inspeccionesAprobadas } = await supabase.from('inspecciones').select('*', { count: 'exact', head: true }).eq('resultado', 'Aprobado');

  const conteoPorUbicacion = {};
  rows.forEach(r => { conteoPorUbicacion[r.ubicacion_nombre] = (conteoPorUbicacion[r.ubicacion_nombre] || 0) + 1; });
  const porUbicacion = Object.entries(conteoPorUbicacion)
    .map(([ubicacion, total]) => ({ ubicacion, total }))
    .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion));

  res.json({ ...stats, totalInspecciones: totalInspecciones || 0, inspeccionesAprobadas: inspeccionesAprobadas || 0, porUbicacion });
});

app.get('/api/notificaciones', requireAuth, async (req, res) => {
  const { data: rows, error } = await supabase.from('extintores').select('codigo, ubicacion_nombre, fecha_vencimiento, estado_manual');
  if (error) return res.status(500).json({ error: 'Error al consultar el inventario.' });

  const notificaciones = rows
    .map(enriquecerExtintor)
    .filter(e => e.estado === 'Vencido' || e.estado === 'Por Vencer')
    .map(e => {
      let severidad = 'warning';
      let mensaje;
      if (e.estado === 'Vencido') {
        severidad = 'error';
        mensaje = `Venció hace ${Math.abs(e.dias_restantes)} día(s). Requiere recarga/prueba inmediata.`;
      } else if (e.dias_restantes <= 5) {
        severidad = 'error';
        mensaje = `Vence en ${e.dias_restantes} día(s). Acción urgente.`;
      } else if (e.dias_restantes <= 15) {
        mensaje = `Vence en ${e.dias_restantes} día(s). Programar mantenimiento.`;
      } else {
        mensaje = `Vence en ${e.dias_restantes} día(s). Dentro de la ventana de 30 días.`;
      }
      return { codigo: e.codigo, ubicacion: e.ubicacion_nombre, estado: e.estado, dias_restantes: e.dias_restantes, severidad, mensaje };
    })
    .sort((a, b) => a.dias_restantes - b.dias_restantes);

  res.json({ notificaciones, total: notificaciones.length });
});

// ---------- Auditoría inmutable ----------

app.get('/api/auditoria', requireRole('Administrador', 'Responsable'), async (req, res) => {
  const { data, error } = await supabase.from('auditoria').select('*').order('id', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Error al consultar la auditoría.' });
  res.json(data);
});

// En local (`npm start`) se levanta el servidor HTTP.
// En Vercel no se llama a listen(): se exporta la app y la plataforma la
// invoca como función serverless (ver api/index.js).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor del Sistema de Extintores corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
