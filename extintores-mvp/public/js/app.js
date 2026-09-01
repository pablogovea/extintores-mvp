// ==================== SONIDOS (Web Audio API, sin archivos externos) ====================
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function tono(frecuencia, duracion, tipo = 'sine', volumen = 0.12, retraso = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    gain.gain.setValueAtTime(volumen, ctx.currentTime + retraso);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + retraso + duracion);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + retraso);
    osc.stop(ctx.currentTime + retraso + duracion);
  } catch (e) { /* audio no disponible */ }
}
const sonidos = {
  success: () => { tono(660, 0.12, 'sine', 0.1); tono(880, 0.18, 'sine', 0.1, 0.1); },
  error: () => { tono(220, 0.22, 'sawtooth', 0.08); tono(160, 0.28, 'sawtooth', 0.08, 0.1); },
  warning: () => { tono(440, 0.15, 'triangle', 0.09); tono(440, 0.15, 'triangle', 0.09, 0.2); },
  info: () => { tono(520, 0.14, 'sine', 0.08); },
};

// ==================== SISTEMA DE ALERTAS (TOAST) ====================
const ICONOS_TOAST = { success: 'check-circle-2', error: 'alert-octagon', warning: 'alert-triangle', info: 'info' };

function mostrarToast({ tipo = 'info', titulo, descripcion = '', duracion = 4200, sonido = true }) {
  const contenedor = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.innerHTML = `
    <i data-lucide="${ICONOS_TOAST[tipo]}" class="toast-icon"></i>
    <div><p class="toast-title">${titulo}</p>${descripcion ? `<p class="toast-desc">${descripcion}</p>` : ''}</div>
  `;
  contenedor.appendChild(el);
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  if (sonido && sonidos[tipo]) sonidos[tipo]();
  setTimeout(() => { el.classList.add('toast-exit'); setTimeout(() => el.remove(), 250); }, duracion);
}
function refrescarIconos() { if (window.lucide) lucide.createIcons(); }

// ==================== UTILIDAD: REDIMENSIONAR IMAGEN A BASE64 ====================
function archivoAImagenComprimida(file, maxDimension = 800, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Archivo de imagen inválido.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) { height = Math.round(height * (maxDimension / width)); width = maxDimension; }
        else if (height > maxDimension) { width = Math.round(width * (maxDimension / height)); height = maxDimension; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}

// ==================== AUTENTICACIÓN Y ROLES ====================
const viewLogin = document.getElementById('view-login');
const viewApp = document.getElementById('view-app');
const formLogin = document.getElementById('form-login');
const loginError = document.getElementById('login-error');
const loginCard = document.querySelector('.login-card');
let usuarioActual = null;

async function verificarSesion() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) { entrarAlApp((await res.json()).usuario, false); return; }
  } catch (e) { /* sin sesión */ }
  viewLogin.classList.remove('hidden');
  viewApp.classList.add('hidden');
  refrescarIconos();
}

// Políticas de acceso en el cliente. Son solo para mostrar/ocultar controles;
// la autorización real la impone el backend en cada endpoint (ver server.js).
//   Inspector     -> ver inventario y registrar inspecciones
//   Responsable   -> además: crear/editar extintores, subir fotos, ver auditoría
//   Administrador -> además: eliminar extintores y gestionar usuarios
function puedeGestionarInventario() { return usuarioActual && (usuarioActual.rol === 'Administrador' || usuarioActual.rol === 'Responsable'); }
function esAdministrador() { return usuarioActual && usuarioActual.rol === 'Administrador'; }

function aplicarPermisosPorRol(rol) {
  const puedeAuditoria = rol === 'Administrador' || rol === 'Responsable';
  const puedeGestionar = rol === 'Administrador' || rol === 'Responsable';
  const puedeAdmin = rol === 'Administrador';
  document.querySelectorAll('[data-vista="auditoria"]').forEach(el => el.classList.toggle('hidden', !puedeAuditoria));
  document.querySelectorAll('[data-vista="admin"]').forEach(el => el.classList.toggle('hidden', !puedeGestionar));
  document.getElementById('btn-exportar-pdf').classList.toggle('hidden', !puedeAuditoria);
  document.getElementById('th-acciones').classList.toggle('hidden', !puedeGestionar);
  document.getElementById('panel-usuarios').classList.toggle('hidden', !puedeAdmin);
}

function entrarAlApp(usuario, esNuevoLogin) {
  usuarioActual = usuario;
  document.getElementById('user-avatar').textContent = usuario.iniciales;
  document.getElementById('user-nombre').textContent = usuario.nombre;
  document.getElementById('user-rol').textContent = usuario.rol;
  aplicarPermisosPorRol(usuario.rol);
  viewLogin.classList.add('hidden');
  viewApp.classList.remove('hidden');
  refrescarIconos();
  cargarDashboard();
  cargarNotificaciones();
  actualizarBannerOffline();
  inicializarFirmaPad();
  if (esNuevoLogin) mostrarToast({ tipo: 'success', titulo: `Bienvenido, ${usuario.nombre.split(' ')[0]}`, descripcion: `Sesión iniciada como ${usuario.rol}` });
}

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const btn = document.getElementById('btn-login');
  const textoOriginal = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'Verificando…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('login-username').value.trim(), password: document.getElementById('login-password').value }),
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || 'No se pudo iniciar sesión.';
      loginError.classList.remove('hidden');
      loginCard.classList.remove('animate-shake'); void loginCard.offsetWidth; loginCard.classList.add('animate-shake');
      sonidos.error();
      return;
    }
    entrarAlApp(data.usuario, true);
    formLogin.reset();
  } catch (err) {
    loginError.textContent = 'Error de conexión con el servidor.';
    loginError.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.innerHTML = textoOriginal; refrescarIconos();
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  usuarioActual = null;
  mostrarToast({ tipo: 'info', titulo: 'Sesión cerrada', descripcion: 'Vuelve pronto.' });
  setTimeout(() => location.reload(), 600);
});

// ==================== NAVEGACIÓN ENTRE VISTAS (top nav + bottom nav movil) ====================
const secciones = {
  dashboard: document.getElementById('view-dashboard'),
  inspeccion: document.getElementById('view-inspeccion'),
  auditoria: document.getElementById('view-auditoria'),
  admin: document.getElementById('view-admin'),
};

function mostrarVista(vista) {
  Object.keys(secciones).forEach(v => secciones[v].classList.toggle('hidden', v !== vista));
  document.querySelectorAll('.top-nav-btn').forEach(btn => btn.classList.toggle('nav-btn-active', btn.dataset.vista === vista));
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.toggle('mobile-nav-active', btn.dataset.vista === vista));
  if (vista === 'dashboard') cargarDashboard();
  if (vista === 'auditoria') cargarAuditoria();
  if (vista === 'admin') { cargarSugerenciasUbicacion(); renderCredencialesQR(); renderFotosLista(); if (esAdministrador()) cargarUsuarios(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refrescarIconos();
}
document.querySelectorAll('.top-nav-btn, .mobile-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => mostrarVista(btn.dataset.vista));
});

// ==================== INDICADOR Y COLA OFFLINE ====================
const CLAVE_PENDIENTES = 'ext_inspecciones_pendientes';
const CLAVE_CACHE_INVENTARIO = 'ext_cache_inventario';

function leerPendientes() { try { return JSON.parse(localStorage.getItem(CLAVE_PENDIENTES)) || []; } catch { return []; } }
function guardarPendientes(lista) { localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(lista)); actualizarBannerOffline(); }

function actualizarIndicadorConexion() {
  const el = document.getElementById('offline-indicator');
  const online = navigator.onLine;
  el.className = `conn-badge ${online ? 'conn-online' : 'conn-offline'}`;
  el.innerHTML = online
    ? '<i data-lucide="wifi" class="w-3.5 h-3.5"></i><span class="hidden md:inline">En línea</span>'
    : '<i data-lucide="wifi-off" class="w-3.5 h-3.5"></i><span class="hidden md:inline">Sin conexión</span>';
  refrescarIconos();
}
function actualizarBannerOffline() {
  const pendientes = leerPendientes();
  const banner = document.getElementById('offline-banner');
  const texto = document.getElementById('offline-banner-texto');
  if (pendientes.length > 0) {
    texto.textContent = `${pendientes.length} inspección(es) guardada(s) en este dispositivo, pendiente(s) de sincronizar.`;
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}
async function sincronizarPendientes(silencioso = false) {
  const pendientes = leerPendientes();
  if (pendientes.length === 0) return;
  if (!navigator.onLine) {
    if (!silencioso) mostrarToast({ tipo: 'warning', titulo: 'Sigues sin conexión', descripcion: 'Se sincronizará automáticamente al recuperar internet.' });
    return;
  }
  let exitosas = 0, fallidas = 0, restantes = [];
  for (const item of pendientes) {
    try {
      const res = await fetch('/api/inspecciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item.payload, origen: 'offline-sync' }) });
      if (res.ok) exitosas++; else { fallidas++; restantes.push(item); }
    } catch (e) { restantes.push(item); }
  }
  guardarPendientes(restantes);
  if (exitosas > 0) { mostrarToast({ tipo: 'success', titulo: 'Sincronización completa', descripcion: `${exitosas} inspección(es) enviada(s) al servidor.` }); cargarDashboard(); }
  if (fallidas > 0) mostrarToast({ tipo: 'error', titulo: 'Algunas inspecciones no se sincronizaron', descripcion: `${fallidas} quedaron pendientes.` });
}
window.addEventListener('online', () => { actualizarIndicadorConexion(); mostrarToast({ tipo: 'info', titulo: 'Conexión recuperada', descripcion: 'Sincronizando datos pendientes…' }); sincronizarPendientes(true); });
window.addEventListener('offline', () => { actualizarIndicadorConexion(); mostrarToast({ tipo: 'warning', titulo: 'Sin conexión a internet', descripcion: 'Las inspecciones se guardarán localmente.' }); });
document.getElementById('btn-sincronizar').addEventListener('click', () => sincronizarPendientes(false));

// ==================== CAMPANA DE NOTIFICACIONES ====================
const bellBtn = document.getElementById('btn-bell');
const bellDropdown = document.getElementById('bell-dropdown');
let notificadosEnEstaSesion = new Set(JSON.parse(sessionStorage.getItem('ext_notificados') || '[]'));

bellBtn.addEventListener('click', (e) => { e.stopPropagation(); bellDropdown.classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!bellDropdown.contains(e.target) && e.target !== bellBtn) bellDropdown.classList.add('hidden'); });

async function cargarNotificaciones() {
  try {
    const res = await fetch('/api/notificaciones');
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('bell-badge');
    const lista = document.getElementById('bell-lista');
    if (data.total > 0) { badge.textContent = data.total > 9 ? '9+' : data.total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    lista.innerHTML = data.notificaciones.length
      ? data.notificaciones.map(n => `
          <div class="bell-item b-${n.severidad}">
            <i data-lucide="${n.severidad === 'error' ? 'alert-octagon' : 'alert-triangle'}" class="b-icon"></i>
            <div><p class="font-semibold text-slate-700">${n.codigo} <span class="text-slate-400 font-normal">· ${n.ubicacion}</span></p><p class="text-slate-500">${n.mensaje}</p></div>
          </div>`).join('')
      : '<div class="bell-empty">Sin alertas pendientes. Todo en orden.</div>';
    refrescarIconos();

    const nuevas = data.notificaciones.filter(n => n.severidad === 'error' && !notificadosEnEstaSesion.has(n.codigo));
    if (nuevas.length > 0) {
      mostrarToast({ tipo: 'warning', titulo: `${nuevas.length} equipo(s) requieren atención urgente`, descripcion: nuevas.slice(0, 2).map(n => n.codigo).join(', ') + (nuevas.length > 2 ? '…' : ''), duracion: 6000 });
      nuevas.forEach(n => notificadosEnEstaSesion.add(n.codigo));
      sessionStorage.setItem('ext_notificados', JSON.stringify([...notificadosEnEstaSesion]));
    }
  } catch (e) { /* sin conexión, se omite */ }
}
setInterval(() => { if (usuarioActual && navigator.onLine) cargarNotificaciones(); }, 60000);

// ==================== DASHBOARD ====================
let chartEstados = null, chartUbicaciones = null;
let inventarioCompleto = [];

function badgeClase(estado) {
  return { 'Operativo': 'badge-operativo', 'Por Vencer': 'badge-por-vencer', 'Vencido': 'badge-vencido', 'Mantenimiento': 'badge-mantenimiento' }[estado] || 'badge-operativo';
}
function formatearFecha(fechaISO) { return new Date(fechaISO).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
function animarContador(id, valorFinal) {
  const el = document.getElementById(id);
  const inicio = Number(el.textContent) || 0;
  const duracionMs = 500, pasoInicio = performance.now();
  function paso(ahora) {
    const progreso = Math.min((ahora - pasoInicio) / duracionMs, 1);
    el.textContent = Math.round(inicio + (valorFinal - inicio) * progreso);
    if (progreso < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

async function cargarDashboard() {
  const tablaLoading = document.getElementById('tabla-loading');
  const tablaBody = document.getElementById('tabla-extintores');
  tablaLoading.classList.remove('hidden');
  tablaLoading.textContent = 'Cargando inventario…';
  tablaBody.innerHTML = '';
  try {
    const [statsRes, extintoresRes] = await Promise.all([fetch('/api/dashboard'), fetch('/api/extintores')]);
    if (!statsRes.ok || !extintoresRes.ok) throw new Error('Error al consultar el servidor.');
    const stats = await statsRes.json();
    const extintores = await extintoresRes.json();
    inventarioCompleto = extintores;
    localStorage.setItem(CLAVE_CACHE_INVENTARIO, JSON.stringify(extintores));

    animarContador('kpi-total', stats.total);
    animarContador('kpi-operativos', stats.operativos);
    animarContador('kpi-por-vencer', stats.por_vencer);
    animarContador('kpi-vencidos', stats.vencidos);
    animarContador('kpi-mantenimiento', stats.mantenimiento);
    renderChartEstados(stats);
    renderChartUbicaciones(stats.porUbicacion);
    renderTabla(extintores);
    tablaLoading.classList.add('hidden');
  } catch (err) {
    tablaLoading.textContent = navigator.onLine ? 'No se pudo cargar la información. Verifica que el servidor esté corriendo.' : 'Sin conexión. Mostrando datos guardados localmente si existen.';
    const cache = JSON.parse(localStorage.getItem(CLAVE_CACHE_INVENTARIO) || 'null');
    if (cache) { inventarioCompleto = cache; renderTabla(cache); tablaLoading.classList.add('hidden'); }
  }
}
function renderChartEstados(stats) {
  const ctx = document.getElementById('chart-estados');
  const data = [stats.operativos, stats.por_vencer, stats.vencidos, stats.mantenimiento];
  if (chartEstados) { chartEstados.data.datasets[0].data = data; chartEstados.update(); return; }
  chartEstados = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['Operativos', 'Por Vencer', 'Vencidos', 'Mantenimiento'], datasets: [{ data, backgroundColor: ['#059669', '#d97706', '#dc2626', '#0284c7'], borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, animation: { animateScale: true, duration: 700, easing: 'easeOutQuart' }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } },
  });
}
function renderChartUbicaciones(porUbicacion) {
  const ctx = document.getElementById('chart-ubicaciones');
  const labels = porUbicacion.map(u => u.ubicacion), data = porUbicacion.map(u => u.total);
  if (chartUbicaciones) { chartUbicaciones.data.labels = labels; chartUbicaciones.data.datasets[0].data = data; chartUbicaciones.update(); return; }
  chartUbicaciones = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Extintores', data, backgroundColor: '#dc2626', borderRadius: 6, maxBarThickness: 42 }] },
    options: { responsive: true, animation: { duration: 700, easing: 'easeOutQuart' }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
}
function renderTabla(extintores) {
  const tbody = document.getElementById('tabla-extintores');
  const gestor = puedeGestionarInventario();
  const admin = esAdministrador();
  tbody.innerHTML = extintores.map((e, i) => `
    <tr class="animate-fade-up" style="animation-delay:${Math.min(i * 0.03, 0.4)}s">
      <td class="px-3 sm:px-5 py-3 font-mono font-semibold text-slate-700">${e.codigo}</td>
      <td class="px-3 sm:px-5 py-3">${e.tipo_agente}</td>
      <td class="px-3 sm:px-5 py-3 text-slate-500 hidden sm:table-cell">${e.ubicacion_nombre}</td>
      <td class="px-3 sm:px-5 py-3 text-slate-500 hidden md:table-cell">${formatearFecha(e.fecha_vencimiento)}</td>
      <td class="px-3 sm:px-5 py-3"><span class="badge ${badgeClase(e.estado)}">${e.estado}</span></td>
      ${gestor ? `
      <td class="px-3 sm:px-5 py-3 text-right whitespace-nowrap">
        <button class="tabla-accion-btn" data-editar="${e.codigo}" title="Editar ${e.codigo}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
        ${admin ? `<button class="tabla-accion-btn tabla-accion-danger" data-eliminar="${e.codigo}" title="Eliminar ${e.codigo}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
      </td>` : ''}
    </tr>`).join('');
  tbody.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abrirModalEditar(b.dataset.editar)));
  tbody.querySelectorAll('[data-eliminar]').forEach(b => b.addEventListener('click', () => eliminarExtintor(b.dataset.eliminar)));
  refrescarIconos();
}
document.getElementById('refresh-dashboard').addEventListener('click', () => { sonidos.info(); cargarDashboard(); cargarNotificaciones(); });
document.getElementById('filtro-tabla').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderTabla(inventarioCompleto.filter(x => x.codigo.toLowerCase().includes(q) || x.ubicacion_nombre.toLowerCase().includes(q)));
});

// ==================== EXPORTAR PDF ====================
document.getElementById('btn-exportar-pdf').addEventListener('click', () => {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const fecha = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    doc.setFontSize(16); doc.setFont(undefined, 'bold');
    doc.text('Reporte de Cumplimiento — Sistema de Extintores', 14, 18);
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(100);
    doc.text(`Generado el ${fecha}  ·  Referencia normativa: NOM-002-STPS (México) / NFPA 10`, 14, 24);
    doc.text(`Elaborado por: ${usuarioActual ? usuarioActual.nombre + ' (' + usuarioActual.rol + ')' : ''}`, 14, 29);
    doc.autoTable({
      startY: 36,
      head: [['Código', 'Agente', 'Capacidad', 'Ubicación', 'Vence', 'Días rest.', 'Estado']],
      body: inventarioCompleto.map(e => [e.codigo, e.tipo_agente, e.capacidad, e.ubicacion_nombre, formatearFecha(e.fecha_vencimiento), String(e.dias_restantes), e.estado]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const v = data.cell.raw;
          if (v === 'Vencido') data.cell.styles.textColor = [220, 38, 38];
          if (v === 'Por Vencer') data.cell.styles.textColor = [217, 119, 6];
          if (v === 'Operativo') data.cell.styles.textColor = [5, 150, 105];
        }
      },
    });
    doc.save(`reporte-cumplimiento-extintores-${new Date().toISOString().slice(0, 10)}.pdf`);
    mostrarToast({ tipo: 'success', titulo: 'PDF generado', descripcion: 'El reporte de cumplimiento se descargó correctamente.' });
  } catch (e) {
    mostrarToast({ tipo: 'error', titulo: 'No se pudo generar el PDF', descripcion: 'Verifica tu conexión (se requieren librerías externas).' });
  }
});

// ==================== INSPECCIÓN RÁPIDA ====================
const inputCodigo = document.getElementById('input-codigo');
const btnBuscar = document.getElementById('btn-buscar');
const msgError = document.getElementById('msg-error');
const msgOfflineCache = document.getElementById('msg-offline-cache');
const fichaVacia = document.getElementById('ficha-vacia');
const fichaLoading = document.getElementById('ficha-loading');
const fichaEquipo = document.getElementById('ficha-equipo');
const fichaRegistrada = document.getElementById('ficha-registrada');
let equipoActual = null;

function ocultarMensajes() { msgError.classList.add('hidden'); msgOfflineCache.classList.add('hidden'); }
function mostrarSoloPanel(panel) {
  [fichaVacia, fichaLoading, fichaEquipo, fichaRegistrada].forEach(p => p.classList.add('hidden'));
  panel.classList.remove('hidden');
  panel.classList.remove('animate-pop-in'); void panel.offsetWidth; panel.classList.add('animate-pop-in');
  refrescarIconos();
}

async function buscarExtintor(codigo) {
  if (!codigo) return;
  ocultarMensajes();
  mostrarSoloPanel(fichaLoading);

  if (!navigator.onLine) {
    const cache = JSON.parse(localStorage.getItem(CLAVE_CACHE_INVENTARIO) || '[]');
    const encontrado = cache.find(x => x.codigo.toUpperCase() === codigo.toUpperCase());
    if (encontrado) {
      equipoActual = encontrado;
      pintarFicha(encontrado);
      mostrarSoloPanel(fichaEquipo);
      msgOfflineCache.classList.remove('hidden');
      inicializarFirmaPad();
      return;
    }
    mostrarSoloPanel(fichaVacia);
    msgError.querySelector('span').textContent = 'Sin conexión y sin datos locales para este código.';
    msgError.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/extintores/${encodeURIComponent(codigo)}`);
    const data = await res.json();
    if (!res.ok) {
      mostrarSoloPanel(fichaVacia);
      msgError.querySelector('span').textContent = data.error || 'Extintor no encontrado.';
      msgError.classList.remove('hidden');
      sonidos.error();
      return;
    }
    equipoActual = data;
    pintarFicha(data);
    mostrarSoloPanel(fichaEquipo);
    inicializarFirmaPad();
    sonidos.info();
  } catch (err) {
    mostrarSoloPanel(fichaVacia);
    msgError.querySelector('span').textContent = 'No fue posible conectar con el servidor. Intenta de nuevo.';
    msgError.classList.remove('hidden');
  }
}

function pintarFicha(e) {
  document.getElementById('ficha-codigo').textContent = e.codigo;
  document.getElementById('ficha-ubicacion').querySelector('span').textContent = `${e.ubicacion_nombre} · ${e.ubicacion_area} (${e.ubicacion_piso})`;
  document.getElementById('ficha-agente').textContent = e.tipo_agente;
  document.getElementById('ficha-capacidad').textContent = e.capacidad;
  document.getElementById('ficha-vence').textContent = formatearFecha(e.fecha_vencimiento);
  document.getElementById('ficha-hidro').textContent = formatearFecha(e.fecha_prueba_hidrostatica);
  document.getElementById('ficha-inspector').textContent = usuarioActual ? `${usuarioActual.nombre} (${usuarioActual.rol})` : '—';
  const badge = document.getElementById('ficha-estado');
  badge.textContent = e.estado; badge.className = `badge ${badgeClase(e.estado)}`;

  const foto = document.getElementById('ficha-foto');
  const placeholder = document.getElementById('ficha-foto-placeholder');
  if (e.foto_base64) { foto.src = e.foto_base64; foto.classList.remove('hidden'); placeholder.classList.add('hidden'); }
  else { foto.classList.add('hidden'); placeholder.classList.remove('hidden'); }
}

btnBuscar.addEventListener('click', () => buscarExtintor(inputCodigo.value.trim()));
inputCodigo.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarExtintor(inputCodigo.value.trim()); });
document.querySelectorAll('.chip-codigo').forEach(chip => chip.addEventListener('click', () => { inputCodigo.value = chip.textContent; buscarExtintor(chip.textContent); }));

// ==================== ESCANEO QR REAL (cámara) ====================
const qrModal = document.getElementById('qr-modal');
const qrModalError = document.getElementById('qr-modal-error');
let html5QrCode = null;

document.getElementById('btn-abrir-camara').addEventListener('click', async () => {
  qrModal.classList.remove('hidden');
  qrModalError.classList.add('hidden');
  refrescarIconos();
  try {
    html5QrCode = new Html5Qrcode('qr-reader');
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (textoDecodificado) => { cerrarCamara(); inputCodigo.value = textoDecodificado.trim(); sonidos.success(); buscarExtintor(textoDecodificado.trim()); },
      () => { /* frames sin QR detectado */ }
    );
  } catch (err) {
    qrModalError.textContent = 'No se pudo acceder a la cámara. Verifica los permisos del navegador o usa el campo de texto.';
    qrModalError.classList.remove('hidden');
  }
});
function cerrarCamara() {
  if (html5QrCode) html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
  qrModal.classList.add('hidden');
}
document.getElementById('btn-cerrar-camara').addEventListener('click', cerrarCamara);

// ==================== FIRMA DIGITAL ====================
let signaturePad = null;
function inicializarFirmaPad() {
  const canvas = document.getElementById('firma-canvas');
  if (!canvas || typeof SignaturePad === 'undefined') return;
  requestAnimationFrame(() => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    signaturePad = new SignaturePad(canvas, { penColor: '#0f172a', backgroundColor: '#f8fafc' });
  });
}
document.getElementById('btn-limpiar-firma').addEventListener('click', () => { if (signaturePad) signaturePad.clear(); });

// ==================== REGISTRAR INSPECCIÓN (online + offline) ====================
document.getElementById('form-inspeccion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultado = e.submitter.dataset.resultado;
  ocultarMensajes();
  const payload = {
    codigo: equipoActual.codigo, resultado,
    presion_ok: document.getElementById('chk-presion').checked,
    precinto_ok: document.getElementById('chk-precinto').checked,
    senaletica_ok: document.getElementById('chk-senaletica').checked,
    observaciones: document.getElementById('input-observaciones').value.trim(),
    firma_base64: (signaturePad && !signaturePad.isEmpty()) ? signaturePad.toDataURL('image/png') : null,
  };
  const boton = e.submitter;
  const textoOriginal = boton.innerHTML;
  boton.disabled = true; boton.innerHTML = 'Guardando…';

  if (!navigator.onLine) {
    const pendientes = leerPendientes();
    pendientes.push({ payload, fecha_local: new Date().toISOString() });
    guardarPendientes(pendientes);
    document.getElementById('registrada-detalle').textContent = `${payload.codigo} — Guardado localmente. Se sincronizará al recuperar conexión.`;
    mostrarSoloPanel(fichaRegistrada);
    mostrarToast({ tipo: 'warning', titulo: 'Guardado sin conexión', descripcion: 'La inspección se sincronizará automáticamente.' });
    boton.disabled = false; boton.innerHTML = textoOriginal; refrescarIconos();
    return;
  }

  try {
    const res = await fetch('/api/inspecciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { msgError.querySelector('span').textContent = data.error || 'No se pudo registrar la inspección.'; msgError.classList.remove('hidden'); sonidos.error(); return; }
    document.getElementById('registrada-detalle').textContent = `${data.extintor.codigo} — Resultado: ${data.inspeccion.resultado} — Estado actual: ${data.extintor.estado}`;
    mostrarSoloPanel(fichaRegistrada);
    if (resultado === 'Aprobado') mostrarToast({ tipo: 'success', titulo: 'Inspección aprobada', descripcion: `${data.extintor.codigo} quedó como Operativo.` });
    else mostrarToast({ tipo: 'warning', titulo: 'Equipo rechazado', descripcion: `${data.extintor.codigo} pasó a Mantenimiento.` });
    cargarNotificaciones();
  } catch (err) {
    msgError.querySelector('span').textContent = 'Error de conexión al registrar la inspección.';
    msgError.classList.remove('hidden');
    sonidos.error();
  } finally {
    boton.disabled = false; boton.innerHTML = textoOriginal; refrescarIconos();
  }
});
document.getElementById('btn-nueva-inspeccion').addEventListener('click', () => { inputCodigo.value = ''; equipoActual = null; mostrarSoloPanel(fichaVacia); inputCodigo.focus(); });

// ==================== AUDITORÍA ====================
const ICONOS_AUDITORIA = {
  'Inicio de sesión': 'log-in', 'Cierre de sesión': 'log-out', 'Login fallido': 'shield-alert',
  'Inspección registrada': 'clipboard-check', 'Alta de extintor': 'plus-circle', 'Foto actualizada': 'image', 'Inicializacion': 'database',
};
async function cargarAuditoria() {
  const lista = document.getElementById('auditoria-lista');
  const loading = document.getElementById('auditoria-loading');
  loading.classList.remove('hidden'); lista.innerHTML = '';
  try {
    const res = await fetch('/api/auditoria');
    if (!res.ok) { loading.textContent = 'No tienes permisos para ver la auditoría.'; return; }
    const registros = await res.json();
    lista.innerHTML = registros.map(r => `
      <div class="auditoria-row">
        <div class="auditoria-icon"><i data-lucide="${ICONOS_AUDITORIA[r.accion] || 'circle'}"></i></div>
        <div class="flex-1 min-w-0">
          <p class="auditoria-accion">${r.accion} <span class="text-slate-400 font-normal">— ${r.usuario_nombre}</span></p>
          ${r.detalle ? `<p class="auditoria-detalle">${r.detalle}</p>` : ''}
          <p class="auditoria-fecha">${new Date(r.fecha).toLocaleString('es-MX')}</p>
        </div>
      </div>`).join('');
    loading.classList.add('hidden');
    refrescarIconos();
  } catch (e) { loading.textContent = 'No se pudo cargar la bitácora.'; }
}

// ==================== ADMINISTRACIÓN: ALTA DE EXTINTOR + FOTO ====================
// La ubicación ya no depende de un select limitado: son campos de texto libre.
// Se cargan sugerencias (ya usadas antes) solo para autocompletar con <datalist>.
async function cargarSugerenciasUbicacion() {
  try {
    const res = await fetch('/api/ubicaciones-sugeridas');
    const { nombres, areas, pisos } = await res.json();
    document.getElementById('lista-ubicaciones').innerHTML = nombres.map(n => `<option value="${n}"></option>`).join('');
    document.getElementById('lista-areas').innerHTML = areas.map(a => `<option value="${a}"></option>`).join('');
    document.getElementById('lista-pisos').innerHTML = pisos.map(p => `<option value="${p}"></option>`).join('');
  } catch (e) { /* sin conexión: el campo sigue siendo de texto libre igual */ }
}

let adminFotoBase64 = null;
document.getElementById('admin-foto-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    adminFotoBase64 = await archivoAImagenComprimida(file);
    const preview = document.getElementById('admin-foto-preview');
    preview.src = adminFotoBase64;
    preview.classList.remove('hidden');
    document.getElementById('admin-foto-placeholder').classList.add('hidden');
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'No se pudo procesar la imagen' });
  }
});

document.getElementById('form-admin-extintor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = document.getElementById('admin-codigo').value.trim().toUpperCase();
  const payload = {
    codigo,
    tipo_agente: document.getElementById('admin-tipo').value,
    capacidad: document.getElementById('admin-capacidad').value.trim(),
    ubicacion_nombre: document.getElementById('admin-ubicacion-nombre').value.trim(),
    ubicacion_area: document.getElementById('admin-ubicacion-area').value.trim(),
    ubicacion_piso: document.getElementById('admin-ubicacion-piso').value.trim(),
    fecha_recarga: document.getElementById('admin-fecha-recarga').value,
    fecha_vencimiento: document.getElementById('admin-fecha-vencimiento').value,
    fecha_prueba_hidrostatica: document.getElementById('admin-fecha-hidro').value,
    foto_base64: adminFotoBase64,
  };
  try {
    const res = await fetch('/api/extintores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { mostrarToast({ tipo: 'error', titulo: 'No se pudo dar de alta', descripcion: data.error }); return; }
    mostrarToast({ tipo: 'success', titulo: 'Equipo registrado', descripcion: `${data.codigo} agregado al inventario, QR generado.` });
    e.target.reset();
    adminFotoBase64 = null;
    document.getElementById('admin-foto-preview').classList.add('hidden');
    document.getElementById('admin-foto-placeholder').classList.remove('hidden');
    cachesQrSvg[data.codigo] = data.qr_svg || null;
    renderCredencialesQR();
    renderFotosLista();
    cargarSugerenciasUbicacion();
    cargarDashboard();
    abrirModalQrNuevo(data.codigo, data.qr_svg);
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo registrar el equipo.' });
  }
});

// ==================== QR: generado y guardado en el servidor (Supabase) ====================
// El backend genera el SVG del QR al crear el equipo y lo guarda en la fila
// (columna extintores.qr_svg). Aquí solo lo insertamos en el DOM; si algún
// equipo no tuviera QR guardado (por ejemplo, datos migrados), se pide una
// vez a /api/extintores/:codigo/qr, que lo genera y lo persiste al vuelo.
const cachesQrSvg = {};

async function obtenerQrSvg(codigo, qrSvgConocido) {
  if (qrSvgConocido) { cachesQrSvg[codigo] = qrSvgConocido; return qrSvgConocido; }
  if (cachesQrSvg[codigo]) return cachesQrSvg[codigo];
  try {
    const res = await fetch(`/api/extintores/${encodeURIComponent(codigo)}/qr`);
    if (!res.ok) return null;
    const data = await res.json();
    cachesQrSvg[codigo] = data.qr_svg;
    return data.qr_svg;
  } catch (e) { return null; }
}

// ==================== MODAL: QR DEL EQUIPO RECIÉN CREADO ====================
const qrNuevoModal = document.getElementById('qr-nuevo-modal');
async function abrirModalQrNuevo(codigo, qrSvgConocido) {
  document.getElementById('qr-nuevo-codigo').textContent = codigo;
  qrNuevoModal.classList.remove('hidden');
  refrescarIconos();
  const contenedor = document.getElementById('qr-nuevo-contenedor');
  contenedor.innerHTML = '<p class="text-xs text-slate-400">Generando…</p>';
  const svg = await obtenerQrSvg(codigo, qrSvgConocido);
  contenedor.innerHTML = svg || '<p class="text-xs text-red-500">No se pudo generar el QR.</p>';
}
document.getElementById('btn-cerrar-qr-nuevo').addEventListener('click', () => qrNuevoModal.classList.add('hidden'));
document.getElementById('btn-imprimir-etiqueta-nueva').addEventListener('click', () => {
  const codigo = document.getElementById('qr-nuevo-codigo').textContent;
  imprimirEtiqueta(codigo);
});

// ==================== CREDENCIALES QR (impresión masiva + individual) ====================
async function renderCredencialesQR() {
  const grid = document.getElementById('qr-grid');
  grid.innerHTML = '<p class="text-slate-400 text-sm col-span-full">Cargando credenciales…</p>';
  try {
    const res = await fetch('/api/extintores');
    const extintores = await res.json();
    grid.innerHTML = '';
    extintores.forEach(e => {
      cachesQrSvg[e.codigo] = e.qr_svg || cachesQrSvg[e.codigo] || null;
      const item = document.createElement('div');
      item.className = 'qr-item';
      const qrDiv = document.createElement('div');
      qrDiv.className = 'qr-svg-contenedor';
      qrDiv.innerHTML = e.qr_svg || '<p class="text-[10px] text-slate-400">Sin QR</p>';
      const label = document.createElement('p');
      label.textContent = e.codigo;
      const btnImprimir = document.createElement('button');
      btnImprimir.className = 'qr-print-btn';
      btnImprimir.innerHTML = '<i data-lucide="printer" class="w-3 h-3"></i> Etiqueta';
      btnImprimir.addEventListener('click', () => imprimirEtiqueta(e.codigo));
      item.append(qrDiv, label, btnImprimir);
      grid.appendChild(item);
    });
    refrescarIconos();
  } catch (e) { grid.innerHTML = '<p class="text-slate-400 text-sm">No se pudo cargar el inventario.</p>'; }
}
// Construye el HTML de una etiqueta (QR + código) para el área de impresión.
function construirEtiquetaHTML(codigo, svg) {
  return `<div class="etiqueta-print">
    <div class="qr-svg-contenedor">${svg || ''}</div>
    <p class="etiqueta-print-codigo">${codigo}</p>
  </div>`;
}

function lanzarImpresion(htmlInterno) {
  const area = document.getElementById('area-impresion');
  area.innerHTML = htmlInterno;
  document.body.classList.add('modo-impresion');
  // dar un tick para que el navegador pinte los SVG antes de abrir el diálogo
  setTimeout(() => window.print(), 60);
}

// Imprimir TODAS las etiquetas del inventario.
document.getElementById('btn-imprimir-qr').addEventListener('click', async () => {
  const btn = document.getElementById('btn-imprimir-qr');
  btn.disabled = true;
  try {
    const res = await fetch('/api/extintores');
    const extintores = await res.json();
    if (!res.ok || !extintores.length) {
      mostrarToast({ tipo: 'warning', titulo: 'No hay equipos para imprimir' });
      return;
    }
    const etiquetas = [];
    for (const e of extintores) {
      const svg = await obtenerQrSvg(e.codigo, e.qr_svg);
      etiquetas.push(construirEtiquetaHTML(e.codigo, svg));
    }
    lanzarImpresion(`<div class="etiquetas-grid">${etiquetas.join('')}</div>`);
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'No se pudieron preparar las etiquetas' });
  } finally {
    btn.disabled = false;
  }
});

// Imprimir una sola etiqueta.
async function imprimirEtiqueta(codigo) {
  const svg = await obtenerQrSvg(codigo);
  if (!svg) { mostrarToast({ tipo: 'error', titulo: 'No se pudo generar el QR de esta etiqueta' }); return; }
  lanzarImpresion(`<div class="etiquetas-grid una-etiqueta">${construirEtiquetaHTML(codigo, svg)}</div>`);
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('modo-impresion');
  document.getElementById('area-impresion').innerHTML = '';
});

// ==================== FOTOS DE EQUIPOS (subir / reemplazar) ====================
async function renderFotosLista() {
  const contenedor = document.getElementById('fotos-lista');
  contenedor.innerHTML = '<p class="text-slate-400 text-sm">Cargando equipos…</p>';
  try {
    const res = await fetch('/api/extintores');
    const extintores = await res.json();
    contenedor.innerHTML = '';
    extintores.forEach(e => {
      const fila = document.createElement('div');
      fila.className = 'foto-item';
      fila.innerHTML = `
        <div class="foto-item-thumb" id="thumb-${e.codigo}">
          ${e.tiene_foto ? '<span class="text-[9px] text-slate-400">cargando…</span>' : '<i data-lucide="image-off" class="w-4 h-4 text-slate-300"></i>'}
        </div>
        <div class="foto-item-info">
          <p>${e.codigo}</p>
          <p>${e.ubicacion_nombre}</p>
        </div>
        <label class="foto-upload-btn">
          <i data-lucide="upload" class="w-3.5 h-3.5"></i> ${e.tiene_foto ? 'Cambiar' : 'Subir'}
          <input type="file" accept="image/*" class="hidden" data-codigo="${e.codigo}" />
        </label>
      `;
      contenedor.appendChild(fila);
      if (e.tiene_foto) cargarMiniaturaFoto(e.codigo);
    });
    refrescarIconos();

    contenedor.querySelectorAll('input[type=file]').forEach(input => {
      input.addEventListener('change', async (ev) => {
        const file = ev.target.files[0];
        const codigo = ev.target.dataset.codigo;
        if (!file) return;
        try {
          const base64 = await archivoAImagenComprimida(file);
          const res = await fetch(`/api/extintores/${encodeURIComponent(codigo)}/foto`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ foto_base64: base64 }),
          });
          if (!res.ok) { const d = await res.json(); mostrarToast({ tipo: 'error', titulo: 'No se pudo subir la foto', descripcion: d.error }); return; }
          mostrarToast({ tipo: 'success', titulo: 'Foto actualizada', descripcion: `${codigo} tiene una nueva fotografía.` });
          renderFotosLista();
        } catch (err) {
          mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo subir la foto.' });
        }
      });
    });
  } catch (e) { contenedor.innerHTML = '<p class="text-slate-400 text-sm">No se pudo cargar el inventario.</p>'; }
}

async function cargarMiniaturaFoto(codigo) {
  try {
    const res = await fetch(`/api/extintores/${encodeURIComponent(codigo)}`);
    const data = await res.json();
    const thumb = document.getElementById(`thumb-${codigo}`);
    if (thumb && data.foto_base64) thumb.innerHTML = `<img src="${data.foto_base64}" alt="${codigo}" />`;
  } catch (e) { /* se omite */ }
}

// ==================== EDITAR / ELIMINAR EXTINTOR ====================
const editarModal = document.getElementById('editar-modal');

function abrirModalEditar(codigo) {
  const e = inventarioCompleto.find(x => x.codigo === codigo);
  if (!e) { mostrarToast({ tipo: 'error', titulo: 'No se encontró el equipo en la vista actual' }); return; }
  document.getElementById('edit-codigo-original').value = e.codigo;
  document.getElementById('edit-codigo').value = e.codigo;
  document.getElementById('edit-capacidad').value = e.capacidad || '';
  document.getElementById('edit-tipo').value = e.tipo_agente;
  document.getElementById('edit-estado').value = e.estado_manual || 'Automático';
  document.getElementById('edit-ubicacion-nombre').value = e.ubicacion_nombre || '';
  document.getElementById('edit-ubicacion-area').value = e.ubicacion_area || '';
  document.getElementById('edit-ubicacion-piso').value = e.ubicacion_piso || '';
  document.getElementById('edit-fecha-recarga').value = e.fecha_recarga || '';
  document.getElementById('edit-fecha-vencimiento').value = e.fecha_vencimiento || '';
  document.getElementById('edit-fecha-hidro').value = e.fecha_prueba_hidrostatica || '';
  cargarSugerenciasUbicacion();
  editarModal.classList.remove('hidden');
  refrescarIconos();
}
function cerrarModalEditar() { editarModal.classList.add('hidden'); }
document.getElementById('btn-cerrar-editar').addEventListener('click', cerrarModalEditar);
document.getElementById('btn-cancelar-editar').addEventListener('click', cerrarModalEditar);

document.getElementById('form-editar-extintor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigoOriginal = document.getElementById('edit-codigo-original').value;
  const payload = {
    codigo: document.getElementById('edit-codigo').value.trim().toUpperCase(),
    tipo_agente: document.getElementById('edit-tipo').value,
    capacidad: document.getElementById('edit-capacidad').value.trim(),
    estado_manual: document.getElementById('edit-estado').value,
    ubicacion_nombre: document.getElementById('edit-ubicacion-nombre').value.trim(),
    ubicacion_area: document.getElementById('edit-ubicacion-area').value.trim(),
    ubicacion_piso: document.getElementById('edit-ubicacion-piso').value.trim(),
    fecha_recarga: document.getElementById('edit-fecha-recarga').value,
    fecha_vencimiento: document.getElementById('edit-fecha-vencimiento').value,
    fecha_prueba_hidrostatica: document.getElementById('edit-fecha-hidro').value,
  };
  try {
    const res = await fetch(`/api/extintores/${encodeURIComponent(codigoOriginal)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { mostrarToast({ tipo: 'error', titulo: 'No se pudo guardar', descripcion: data.error }); return; }
    mostrarToast({ tipo: 'success', titulo: 'Extintor actualizado', descripcion: `${data.codigo} guardado correctamente.` });
    cerrarModalEditar();
    if (payload.codigo !== codigoOriginal) { delete cachesQrSvg[codigoOriginal]; cachesQrSvg[data.codigo] = data.qr_svg || null; }
    cargarDashboard();
    cargarNotificaciones();
    if (!secciones.admin.classList.contains('hidden')) { renderCredencialesQR(); renderFotosLista(); }
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo actualizar el equipo.' });
  }
});

async function eliminarExtintor(codigo) {
  if (!confirm(`¿Eliminar el extintor ${codigo}?\n\nSe borrará también su historial de inspecciones. Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch(`/api/extintores/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { mostrarToast({ tipo: 'error', titulo: 'No se pudo eliminar', descripcion: data.error }); return; }
    mostrarToast({ tipo: 'success', titulo: 'Extintor eliminado', descripcion: `${codigo} se quitó del inventario.` });
    delete cachesQrSvg[codigo];
    cargarDashboard();
    cargarNotificaciones();
    if (!secciones.admin.classList.contains('hidden')) { renderCredencialesQR(); renderFotosLista(); }
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo eliminar el equipo.' });
  }
}

// ==================== GESTIÓN DE USUARIOS (solo Administrador) ====================
const formUsuario = document.getElementById('form-usuario');
const ICONO_ROL = { Inspector: 'scan-line', Responsable: 'clipboard-check', Administrador: 'shield' };
let usuariosCargados = [];

function escaparHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function cargarUsuarios() {
  const tbody = document.getElementById('tabla-usuarios');
  tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-slate-400 text-sm">Cargando usuarios…</td></tr>';
  try {
    const res = await fetch('/api/usuarios');
    const usuarios = await res.json();
    if (!res.ok) throw new Error();
    usuariosCargados = usuarios;
    tbody.innerHTML = usuarios.map(u => `
      <tr>
        <td class="px-3 py-2 font-medium text-slate-700">${escaparHtml(u.nombre)}</td>
        <td class="px-3 py-2 text-slate-500 font-mono">${escaparHtml(u.username)}</td>
        <td class="px-3 py-2"><span class="rol-chip"><i data-lucide="${ICONO_ROL[u.rol] || 'user'}" class="w-3 h-3"></i> ${u.rol}</span></td>
        <td class="px-3 py-2 text-right whitespace-nowrap">
          <button class="tabla-accion-btn" data-editar-usuario="${u.id}" title="Editar ${escaparHtml(u.username)}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
          <button class="tabla-accion-btn tabla-accion-danger" data-eliminar-usuario="${u.id}" title="Eliminar ${escaparHtml(u.username)}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-editar-usuario]').forEach(b => b.addEventListener('click', () => {
      const u = usuariosCargados.find(x => String(x.id) === b.dataset.editarUsuario);
      if (u) cargarUsuarioEnForm(u);
    }));
    tbody.querySelectorAll('[data-eliminar-usuario]').forEach(b => b.addEventListener('click', () => {
      const u = usuariosCargados.find(x => String(x.id) === b.dataset.eliminarUsuario);
      if (u) eliminarUsuario(u.id, u.username);
    }));
    refrescarIconos();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-slate-400 text-sm">No se pudo cargar la lista de usuarios.</td></tr>';
  }
}

function cargarUsuarioEnForm(u) {
  document.getElementById('usuario-id').value = u.id;
  document.getElementById('usuario-nombre').value = u.nombre;
  document.getElementById('usuario-username').value = u.username;
  document.getElementById('usuario-username').disabled = true;
  document.getElementById('usuario-rol').value = u.rol;
  document.getElementById('usuario-password').value = '';
  document.getElementById('usuario-pass-label').textContent = 'Contraseña (dejar vacío = sin cambio)';
  document.getElementById('usuario-submit').innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Guardar cambios';
  document.getElementById('usuario-cancelar').classList.remove('hidden');
  refrescarIconos();
  document.getElementById('panel-usuarios').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetFormUsuario() {
  formUsuario.reset();
  document.getElementById('usuario-id').value = '';
  document.getElementById('usuario-username').disabled = false;
  document.getElementById('usuario-pass-label').textContent = 'Contraseña';
  document.getElementById('usuario-submit').innerHTML = '<i data-lucide="user-plus" class="w-4 h-4"></i> Crear usuario';
  document.getElementById('usuario-cancelar').classList.add('hidden');
  refrescarIconos();
}
document.getElementById('usuario-cancelar').addEventListener('click', resetFormUsuario);

formUsuario.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('usuario-id').value;
  const password = document.getElementById('usuario-password').value;
  const body = {
    nombre: document.getElementById('usuario-nombre').value.trim(),
    rol: document.getElementById('usuario-rol').value,
  };
  if (password) body.password = password;
  let url = '/api/usuarios', method = 'POST';
  if (id) { url += '/' + id; method = 'PUT'; }
  else { body.username = document.getElementById('usuario-username').value.trim().toLowerCase(); body.password = password; }

  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { mostrarToast({ tipo: 'error', titulo: 'No se pudo guardar', descripcion: data.error }); return; }
    mostrarToast({ tipo: 'success', titulo: id ? 'Usuario actualizado' : 'Usuario creado', descripcion: `${data.nombre} (${data.rol}).` });
    resetFormUsuario();
    // Si el administrador se editó a sí mismo (p. ej. cambió su rol o nombre),
    // recargamos para que la sesión y los permisos de la interfaz se actualicen.
    if (id && usuarioActual && Number(id) === usuarioActual.id) {
      setTimeout(() => location.reload(), 800);
      return;
    }
    cargarUsuarios();
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo guardar el usuario.' });
  }
});

async function eliminarUsuario(id, username) {
  if (!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch('/api/usuarios/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { mostrarToast({ tipo: 'error', titulo: 'No se pudo eliminar', descripcion: data.error }); return; }
    mostrarToast({ tipo: 'success', titulo: 'Usuario eliminado', descripcion: `"${username}" fue dado de baja.` });
    cargarUsuarios();
  } catch (err) {
    mostrarToast({ tipo: 'error', titulo: 'Error de conexión', descripcion: 'No se pudo eliminar el usuario.' });
  }
}

// ==================== INICIO ====================
refrescarIconos();
actualizarIndicadorConexion();
verificarSesion();
