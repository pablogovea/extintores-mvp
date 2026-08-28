// Siembra datos de demostración en Supabase.
// Uso:
//   node scripts/seed-supabase.js            -> siembra solo si las tablas están vacías
//   node scripts/seed-supabase.js --reset     -> borra todo y vuelve a sembrar

require('dotenv').config();
const supabase = require('../lib/supabaseClient');
const { hashPassword } = require('../lib/auth');
const { generarQrSvg } = require('../lib/qr');

const shouldReset = process.argv.includes('--reset');
const CONTRASENA_DEMO = 'extintor2026';

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function borrarTodo() {
  console.log('Eliminando datos existentes…');
  await supabase.from('inspecciones').delete().gte('id', 0);
  await supabase.from('auditoria').delete().gte('id', 0);
  await supabase.from('extintores').delete().gte('id', 0);
  await supabase.from('usuarios').delete().gte('id', 0);
}

async function sembrar() {
  const { count, error: errCount } = await supabase.from('extintores').select('*', { count: 'exact', head: true });
  if (errCount) {
    console.error('\n❌ No se pudo conectar con Supabase. Verifica SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu .env');
    console.error('   Detalle:', errCount.message);
    process.exit(1);
  }

  if (shouldReset) {
    await borrarTodo();
  } else if (count > 0) {
    console.log('La base de datos ya tiene datos, se omite el seed. Usa --reset para reiniciarla.');
    return;
  }

  // --- Usuarios ---
  const usuariosBase = [
    ['Carlos Mendoza', 'carlos', 'Inspector', 'CM'],
    ['Ana Torres', 'ana', 'Responsable', 'AT'],
    ['Luis Fernandez', 'luis', 'Inspector', 'LF'],
    ['Admin Sistema', 'admin', 'Administrador', 'AS'],
  ];
  const usuariosInsertar = usuariosBase.map(([nombre, username, rol, iniciales]) => {
    const { salt, hash } = hashPassword(CONTRASENA_DEMO);
    return { nombre, username, rol, iniciales, password_hash: hash, password_salt: salt };
  });
  const { data: usuariosCreados, error: errUsuarios } = await supabase.from('usuarios').insert(usuariosInsertar).select();
  if (errUsuarios) throw errUsuarios;
  const idPorUsername = Object.fromEntries(usuariosCreados.map(u => [u.username, u.id]));

  // --- Extintores (ubicación como texto libre, ya no una tabla aparte) ---
  const extintoresBase = [
    ['EXT-001', 'PQS-ABC', '10 lb', 'Recepción Principal', 'Administrativa', 'PB', -200, 165, 900, null],
    ['EXT-002', 'CO2', '5 lb', 'Almacén General', 'Logística', 'PB', -350, 15, 500, null],
    ['EXT-003', 'PQS-ABC', '20 lb', 'Laboratorio de Sistemas', 'Académica', 'Piso 2', -400, -10, 300, null],
    ['EXT-004', 'Agua', '2.5 gal', 'Cafetería', 'Servicios', 'PB', -100, 265, 1200, null],
    ['EXT-005', 'Espuma AFFF', '10 lb', 'Sala de Servidores', 'TI', 'Piso 1', -500, -40, 60, null],
    ['EXT-006', 'PQS-ABC', '10 lb', 'Almacén General', 'Logística', 'PB', -30, 335, 1500, 'Mantenimiento'],
    ['EXT-007', 'CO2', '5 lb', 'Laboratorio de Sistemas', 'Académica', 'Piso 2', -150, 20, 700, null],
    ['EXT-008', 'K', '6 lb', 'Cafetería', 'Servicios', 'PB', -80, 285, 1600, null],
  ];

  const extintoresInsertar = [];
  for (const [codigo, tipo_agente, capacidad, ubicacion_nombre, ubicacion_area, ubicacion_piso, recarga, vence, hidro, estado_manual] of extintoresBase) {
    const qr_svg = await generarQrSvg(codigo);
    extintoresInsertar.push({
      codigo, tipo_agente, capacidad, ubicacion_nombre, ubicacion_area, ubicacion_piso,
      fecha_recarga: addDays(recarga), fecha_vencimiento: addDays(vence), fecha_prueba_hidrostatica: addDays(hidro),
      estado_manual, qr_svg,
    });
  }
  const { data: extintoresCreados, error: errExtintores } = await supabase.from('extintores').insert(extintoresInsertar).select();
  if (errExtintores) throw errExtintores;
  const idPorCodigo = Object.fromEntries(extintoresCreados.map(e => [e.codigo, e.id]));

  // --- Inspecciones de ejemplo ---
  const inspecciones = [
    { codigo: 'EXT-001', username: 'carlos', dias: -30, resultado: 'Aprobado', presion: 1, precinto: 1, senal: 1, obs: 'Equipo en condiciones óptimas.' },
    { codigo: 'EXT-002', username: 'ana', dias: -15, resultado: 'Aprobado', presion: 1, precinto: 1, senal: 1, obs: 'Manómetro en zona verde.' },
    { codigo: 'EXT-003', username: 'luis', dias: -60, resultado: 'Rechazado', presion: 0, precinto: 1, senal: 1, obs: 'Presión baja, requiere recarga urgente.' },
    { codigo: 'EXT-005', username: 'carlos', dias: -5, resultado: 'Rechazado', presion: 1, precinto: 0, senal: 1, obs: 'Precinto de seguridad roto.' },
  ];
  const inspeccionesInsertar = inspecciones.map(i => ({
    extintor_id: idPorCodigo[i.codigo],
    usuario_id: idPorUsername[i.username],
    fecha: addDays(i.dias),
    resultado: i.resultado,
    presion_ok: !!i.presion,
    precinto_ok: !!i.precinto,
    senaletica_ok: !!i.senal,
    observaciones: i.obs,
    origen: 'online',
  }));
  const { error: errInspecciones } = await supabase.from('inspecciones').insert(inspeccionesInsertar);
  if (errInspecciones) throw errInspecciones;

  await supabase.from('auditoria').insert({
    usuario_id: null,
    usuario_nombre: 'Sistema',
    accion: 'Inicializacion',
    detalle: 'Base de datos de Supabase creada y poblada con datos de demostración.',
  });

  console.log(`Seed completo: ${usuariosCreados.length} usuarios, ${extintoresCreados.length} extintores (con QR generado), ${inspeccionesInsertar.length} inspecciones.`);
  console.log(`Contraseña de demo para todos los usuarios: "${CONTRASENA_DEMO}"`);
  console.log('Usuarios: carlos / ana / luis / admin');
}

sembrar()
  .then(() => process.exit(0))
  .catch(err => { console.error('\n❌ Error al sembrar datos:', err.message || err); process.exit(1); });
