const QRCode = require('qrcode');

// Genera el codigo QR de un extintor como SVG (texto), listo para guardarse
// directamente en la base de datos (columna extintores.qr_svg) y para
// renderizarse en el navegador con solo insertarlo como HTML.
// Se codifica el "codigo" del equipo (ej. "EXT-009"), el mismo texto que
// hoy en dia se escribe manualmente o se lee al escanear con la camara.
function generarQrSvg(codigo) {
  return QRCode.toString(codigo, {
    type: 'svg',
    margin: 1,
    width: 240,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

module.exports = { generarQrSvg };
