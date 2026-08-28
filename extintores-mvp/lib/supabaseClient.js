require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '\n❌ Faltan variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n' +
    '   Copia .env.example a .env y completa los valores de tu proyecto de Supabase\n' +
    '   (Dashboard → Project Settings → API).\n'
  );
  process.exit(1);
}

// Se usa la service_role key porque el control de acceso (login, roles,
// sesiones) ya lo hace este servidor Express — la service_role key NUNCA
// debe exponerse al navegador ni subirse a un repositorio publico.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
