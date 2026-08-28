# Sistema Inteligente de Gestión de Extintores — MVP (Supabase)

Backend en Node.js + Express, base de datos en **Supabase (Postgres)**, frontend responsivo sin build step.

## 1. Crear el proyecto en Supabase
1. Ve a https://supabase.com → **New project** (elige región, contraseña de base de datos, etc.).
2. Cuando el proyecto esté listo, entra a **SQL Editor → New query**, pega el contenido completo de [`supabase/schema.sql`](./supabase/schema.sql) y ejecútalo. Esto crea las tablas `usuarios`, `extintores`, `inspecciones` y `auditoria`.
3. Ve a **Project Settings → API** y copia:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (¡no la `anon` key!) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Configurar el proyecto localmente
```bash
cd extintores-mvp
cp .env.example .env
# Edita .env y pega tu SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed        # siembra usuarios y extintores de demo en Supabase
npm start            # http://localhost:3000
```

> ⚠️ La `service_role key` tiene permisos totales sobre tu base de datos y **nunca** debe llegar al navegador ni a un repositorio público. Solo vive en `.env` (ya está en `.gitignore`) y, al desplegar, en las variables de entorno del hosting (Vercel, etc.).

## Usuarios de prueba (login)
Contraseña de demo para todos: **`extintor2026`**

| Usuario | Rol | Puede |
|---|---|---|
| `carlos` / `luis` | Inspector | Registrar inspecciones |
| `ana` | Responsable | + Auditoría + exportar PDF |
| `admin` | Administrador | + Alta de extintores + fotos + credenciales QR |

## Los dos ajustes de esta versión

**1. Ubicación como texto libre**
Ya no existe una tabla `ubicaciones` con una lista fija. El campo "Ubicación" (más área/piso opcionales) es texto libre que el administrador escribe como necesite; el sistema solo sugiere valores ya usados antes (con un `<datalist>` del navegador) para mantener cierta consistencia, pero nunca limita lo que se puede escribir.

**2. Generación y guardado real de códigos QR**
Investigué la forma más ligera y robusta de resolver esto: el paquete `qrcode` de Node genera el código como **SVG en texto** (~1 KB por código), no como imagen binaria. Ese SVG se guarda directamente en la columna `extintores.qr_svg` de Supabase en el momento en que el administrador da de alta el equipo — ya no se genera solo "al vuelo" en el navegador y se pierde; queda persistido en la base de datos. El frontend simplemente inserta ese SVG en la página para mostrarlo o imprimirlo. Si algún equipo antiguo no tuviera QR guardado, el endpoint `GET /api/extintores/:codigo/qr` lo genera una vez y lo guarda, para que no se regenere cada vez.

Esta lógica se probó con un cliente de Supabase simulado en memoria que ejecuta las mismas rutas de `server.js` (17 pruebas, incluyendo login, roles, alta con ubicación libre, generación/persistencia del QR y auditoría) — todas pasaron. Lo que **no** pude probar desde este entorno es la conexión real a tu proyecto de Supabase (no tengo acceso a internet hacia supabase.co), así que te recomiendo correr `npm run seed` y revisar que todo cargue bien como primer paso.

## Otras funcionalidades (de versiones anteriores, ya migradas a Supabase)
- Escaneo QR real con cámara + modo offline con sincronización automática.
- Firma digital del inspector, auditoría inmutable, exportación a PDF.
- Notificaciones proactivas (vencimientos a 30/15/5 días) con campana y sonido.
- Roles reales (Inspector / Responsable / Administrador) validados en el backend.
- Diseño responsivo con navegación inferior en móvil/iPad.
- Fotos de extintores (subir/reemplazar), comprimidas en el navegador antes de guardarse.

## Reiniciar los datos de demo
```bash
npm run seed:reset
```

## ⚠️ Antes de desplegar en Vercel
Con Supabase como base de datos ya no depende de un archivo local — ese problema quedó resuelto. Lo que sí falta ajustar para Vercel serverless es el manejo de sesión: ahora mismo usa `express-session` con almacenamiento en memoria (`MemoryStore`), que funciona perfecto corriendo `npm start` en un servidor normal, pero en funciones serverless cada invocación puede caer en una instancia distinta sin memoria compartida, así que el login podría "perderse" entre peticiones. Cuando quieras dar ese paso, lo más sencillo es cambiar a un token de sesión firmado (JWT) guardado en una cookie httpOnly, que no depende de memoria compartida — puedo ayudarte con ese cambio cuando llegues a esa parte.
