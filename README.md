# Elvira Technologies — Login con Discord + verificación de Roblox

Este proyecto ya incluye:

- Web estática (`index.html`, `store.html`, `dashboard.html`, `onboarding.html`).
- Backend serverless en `/api` (pensado para Vercel) que hace:
  - Login con Discord (OAuth2).
  - Verificación/vinculación de Roblox (OAuth2).
  - Sesión con cookie firmada (JWT).
  - Guardado del usuario en una base de datos Supabase (Postgres gratis).
  - Edición del email de la cuenta desde el Dashboard.

No necesitas programar nada más: solo crear las cuentas gratuitas de abajo,
pegar las claves en las variables de entorno, y desplegar.

---

## 1. Crear la base de datos gratis (Supabase)

1. Ve a https://supabase.com y crea una cuenta gratis.
2. "New project" → ponle un nombre, elige una contraseña de base de datos y una región.
3. Cuando el proyecto esté listo, ve a **SQL Editor** → **New query**, pega el
   contenido del archivo `supabase-setup.sql` (incluido en este zip) y dale a **Run**.
   Esto crea la tabla `users`.
4. Ve a **Project Settings → API** y copia:
   - **Project URL** → lo pegarás en `SUPABASE_URL`.
   - **service_role key** (la secreta, NO la "anon") → lo pegarás en `SUPABASE_SERVICE_ROLE_KEY`.
     ⚠️ Esta clave nunca va en el código del navegador, solo en las variables de entorno del servidor (Vercel).

## 2. Crear la app de Discord (login)

1. Ve a https://discord.com/developers/applications → **New Application**.
2. En **OAuth2 → General**, copia el **Client ID** y el **Client Secret**.
3. En **OAuth2 → Redirects**, añade:
   `https://TU-DOMINIO.vercel.app/api/auth/discord/callback`
   (usa el mismo dominio que te dé Vercel al desplegar; puedes editarlo después).

## 3. Vincular Roblox: crear el juego de verificación (gratis, sin dominio)

Como no vas a pagar un dominio propio, Roblox bloquea el login OAuth normal (exige dominios "de confianza",
y `tudominio.vercel.app` cuenta como dominio compartido). Por eso este proyecto usa otro método, sin coste:
un código de 6 dígitos que el usuario introduce dentro de un juego de Roblox tuyo.

1. Genera un secreto compartido (cualquier cadena larga aleatoria) y guárdalo — lo necesitas en dos sitios:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Ese valor va en la variable `ROBLOX_GAME_SECRET` (paso 4) Y dentro del script del juego (siguiente paso).

2. Abre Roblox Studio → crea un lugar nuevo (Baseplate vale) → publícalo (aunque sea privado por ahora).

3. En el **Explorer**:
   - Click derecho en **StarterGui** → Insert Object → **LocalScript**. Pega ahí el contenido de
     `roblox-game/StarterGui_VerificationClient.lua` (incluido en este zip).
   - Click derecho en **ServerScriptService** → Insert Object → **Script**. Pega ahí el contenido de
     `roblox-game/ServerScriptService_VerificationServer.lua`.
   - En ese segundo script, edita las dos líneas de arriba:
     - `BACKEND_URL` → tu dominio de Vercel + `/api/roblox/code/redeem` (ej. `https://elvira-sigma.vercel.app/api/roblox/code/redeem`).
     - `SHARED_SECRET` → el mismo valor que generaste en el paso 1.

4. Ve a **Home → Game Settings → Security** y activa **"Allow HTTP Requests"**. Sin esto, el script no
   podrá hablar con tu web. Guarda los cambios.

5. Publica el juego (File → Publish to Roblox). Copia el enlace del juego (algo como
   `https://www.roblox.com/games/123456789/...`).

6. En `onboarding.html`, busca la línea del botón "Open the verification game" y sustituye el enlace de
   ejemplo por el enlace real de tu juego:
   ```html
   <a href="https://www.roblox.com/games/TU-PLACE-ID/Elvira-Account-Verification" ...>
   ```

## 4. Rellenar el archivo de configuración

Este es el archivo de config que pediste: **`.env.example`** (incluido en el zip).

1. Duplica `.env.example` y renómbralo a `.env.local`.
2. Pega ahí los valores de Discord, Roblox y Supabase del paso 1-3.
3. En `SESSION_SECRET`, pega cualquier cadena larga aleatoria (puedes generarla con
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
4. Cuando despliegues en Vercel, vuelve a pegar estas MISMAS variables en
   **Vercel → tu proyecto → Settings → Environment Variables** (el archivo `.env.local`
   nunca se sube a GitHub, así que Vercel necesita su propia copia).

## 5. Subir el proyecto a GitHub por primera vez

Desde la carpeta `elvira` (la que contiene este README):

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPOSITORIO.git
git push -u origin main
```

(Antes crea el repositorio vacío en https://github.com/new — sin README, sin .gitignore,
para que no choque con el `git push`.)

## 6. Subir tu GitHub a Vercel

**Opción recomendada (interfaz web):**
1. Ve a https://vercel.com → **Add New… → Project**.
2. Importa el repositorio de GitHub que acabas de subir.
3. En "Environment Variables", pega todas las variables del `.env.example`.
4. Dale a **Deploy**.

**Opción por terminal:**
```bash
npm i -g vercel
vercel login
vercel link
vercel env add DISCORD_CLIENT_ID
vercel env add DISCORD_CLIENT_SECRET
vercel env add DISCORD_REDIRECT_URI
vercel env add ROBLOX_GAME_SECRET
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SESSION_SECRET
vercel --prod
```

Cuando Vercel te dé tu dominio final (por ejemplo `elvira-sigma.vercel.app`), actualiza:
- `DISCORD_REDIRECT_URI` (en Vercel y en el Developer Portal de Discord) → `https://TU-DOMINIO.vercel.app/api/auth/discord/callback`
- `BACKEND_URL` dentro de `ServerScriptService_VerificationServer.lua` en tu juego de Roblox → `https://TU-DOMINIO.vercel.app/api/roblox/code/redeem`

## Cómo funciona el flujo

1. El usuario pulsa **Log in** en el encabezado → va directo a Discord, acepta.
2. Discord redirige a `/api/auth/discord/callback` → se crea/actualiza el usuario en Supabase
   (guarda `discord_username` y `email`) y se crea la sesión (cookie).
3. Si el usuario no tiene aún Roblox vinculado → se le manda a `onboarding.html`.
4. En `onboarding.html`, la web pide un código de 6 dígitos a `/api/roblox/code/generate` (válido 5 minutos,
   se autorrenueva solo). El usuario abre el juego de Roblox, escribe el código, y el script del juego lo
   manda a `/api/roblox/code/redeem` junto con su UserId y username de Roblox (tomados directamente del
   objeto `Player`, así que no se pueden falsificar desde el cliente).
5. Si el código es válido, se guarda `roblox_username`/`roblox_id` en la fila del usuario. La página
   `onboarding.html` detecta esto solo (consulta `/api/session` cada 3 segundos), muestra la animación de
   éxito y pasa al Dashboard automáticamente.
6. Si un usuario logueado pero sin Roblox verificado intenta entrar directo a `dashboard.html`,
   `assets/js/elvira-auth.js` lo redirige de vuelta a `onboarding.html` automáticamente, siempre,
   hasta que complete la verificación.
7. Una vez con sesión, en el encabezado de todas las páginas aparece su avatar de Discord + nombre
   con una flechita, con el desplegable: **My dashboard / My licenses / My purchases / Log out**.
8. En el Dashboard, la tarjeta "Contact information" ya usa los datos reales de la sesión, y el
   botón **Edit** permite cambiar el email (Discord y Roblox quedan bloqueados, no editables).

## Nota importante

El backend (`/api`) necesita ejecutarse en un entorno con Node.js (como Vercel) — no funciona
abriendo los `.html` directamente desde tu ordenador ("file://"). Para probarlo en local usa
`vercel dev` desde esta carpeta una vez tengas `vercel` instalado y las variables en `.env.local`.

---

## v2 — Roles, blocking, products, licenses, promotions, Management Area

This update adds:

- **Roles**: `customer` (default), `staff`, `admin`. `iconicutie` and `barbiedoll4` keep admin automatically
  (the SQL migration below sets this).
- **User blocking**: a blocked user is sent to `block.html` on every login and every page load, until an
  admin unblocks them.
- **Products, licenses, purchases, promotions**: new tables, all created by the SQL below.
- **File storage**: two Supabase Storage buckets are created automatically by the SQL —
  `product-media` (public: images/videos shown in the store) and `product-files` (private: files a
  customer receives after buying). Product images/files are uploaded straight from the browser to
  Storage using short-lived signed upload URLs — no file ever passes through the Vercel function.
- **New pages**: `product.html` (public product page), `managementarea.html` (admin/staff dashboard with
  User Management / Products / Promotions / Bot Configuration / Interactivity tabs), `product-editor.html`
  (add/edit a product), `block.html`.
- **Interactivity**: the status bar and information window you configure in Management Area now actually
  render on every page of the site (via `assets/js/elvira-auth.js`).

### 1. Re-run the SQL

Open Supabase → SQL Editor and run `supabase-setup.sql` again (the whole file — it's safe to run more than
once; it only adds what's missing).

### 2. New environment variable (optional)

`SUPABASE_PUBLISHABLE_KEY` — Project Settings → API Keys → the **publishable** key (`sb_publishable_...`).
It's safe to be public and is reserved for future client-side use; the site works without it today.

### 3. Redeploy

Push to GitHub as usual (see the commands above) — Vercel redeploys automatically. Nothing else changes:
your existing Discord login, Roblox verification game, and dashboard keep working exactly as before.

### Notes on what's intentionally still a placeholder

- **Bot Configuration** tab: shows "coming soon", as requested — nothing to configure yet.
- **Checkout**: there is no payment flow yet. "Buy now" on a product page shows a placeholder message, and
  admins can still get products to specific users for testing with the **Give** button in Management Area
  → Products, or by using **Add new user** + editing purchases directly in Supabase.
- **Purchases table**: `purchases` is ready for a future checkout to write to; nothing writes to it yet.


---

## v3 — Seguridad y arreglo de errores 500 (Management Area)

- **Causa de los 500**: el router `/api/admin` dependía de la librería `sanitize-html`, que no se cargaba en Vercel y hacía caer TODA la API de admin. Ahora el limpiador de texto es propio (`api/_lib/sanitize.js`, sin dependencias) y cada ruta se carga por separado.
- **Páginas privadas**: `managementarea.html` y `product-editor.html` viven en `api/_private/` y solo se envían (vía `api/page.js`) a admin/staff logueados y no bloqueados. Para cualquier otra persona la respuesta es un 404 normal: el código de esas páginas no es público.
- **API admin**: solo mismo origen, cabecera `X-Requested-With: elvira-admin` en escrituras (anti-CSRF), rol releído de la base de datos en cada petición, límite de peticiones, bloqueo tras intentos denegados, cabeceras de seguridad y registro de acciones (`admin_audit_log`).
- **No se despliegan** (ver `.vercelignore`): `roblox-game/`, `supabase-setup.sql`, `README.md`, `.env.example`.
- **IMPORTANTE**: el secreto del juego de Roblox estaba escrito en el `.lua` y en GitHub. Genera uno nuevo, ponlo en Vercel (`ROBLOX_GAME_SECRET`) y en Roblox Studio, y no lo subas a GitHub.
- Ejecuta de nuevo `supabase-setup.sql` (es seguro repetirlo) para crear la tabla de auditoría y cerrar permisos.
- En Management Area, si falta algo de la configuración, aparece un aviso solo para admins.
