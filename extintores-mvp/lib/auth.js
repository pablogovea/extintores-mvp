const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verificarPassword(password, hashGuardado, salt) {
  const hashIntento = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hashIntento), Buffer.from(hashGuardado));
}

module.exports = { hashPassword, verificarPassword };
