# Elvira — Pagos, licencias y bot Elvire (guía rápida)

## Qué se añadió
- Carrito (icono blanco junto al login, contador, panel a mitad de página, fondo #2d2d2d 80%).
- `yourorder.html` (resumen oscuro + pago Shoppex a la derecha), `ordercompleted.html`, `download.html`.
- "My Licenses" en `dashboard.html` (botón Descargar, enlaces de 5 min).
- `managementarea.html`: historial completo por usuario + pestaña **Sales** (ver detalle / eliminar), solo admin.
- Bot **Elvire** en la carpeta `bot/` (MD de venta, recibo .txt, botón de descarga, `/retrieve`, embed al canal 1556033428099432479, ventas fallidas).
- Web 100 % en inglés y responsive; bot en español como pediste.

## 1. Supabase
Ejecuta de nuevo **todo** `supabase-setup.sql` (es seguro repetirlo). Crea las tablas nuevas de ventas, tokens y cola del bot.

## 2. Shoppex.io  (archivo de configuración: `.env.example`)
1. Crea tu tienda en https://dashboard.shoppex.io y conecta al menos una pasarela (Stripe/PayPal/cripto).
2. Dashboard → Settings → Developer → crea una **API key secreta** (`shx_...`) → `SHOPPEX_API_KEY`.
3. `SHOPPEX_CURRENCY=EUR` (la moneda de tu tienda).
4. **No** necesitas crear productos en Shoppex ni configurar un webhook global: la web crea cada pago con el importe calculado en el servidor y un webhook propio firmado por pedido.
5. En Vercel → Settings → Environment Variables pega TODAS las variables de `.env.example` (incluida `SITE_URL=https://tu-dominio.vercel.app`) y redespliega.
6. Prueba con el modo Test de Shoppex (tarjeta 4242 4242 4242 4242).

Nota: el formulario de pago de Shoppex se muestra dentro de la mitad blanca (iframe). Si Shoppex no permitiera mostrarse en un marco, aparece debajo el enlace "Open the secure payment page in a new tab" y la web detecta igualmente el pago.

## 3. Subir a GitHub / Vercel
```bash
git add . && git commit -m "checkout + bot" && git push
```
Vercel redespliega solo. (Funciones usadas: 11 de 12 del plan gratis.)

## 4. Bot en Render (24/7)
1. Discord Developer Portal → New Application → Bot → copia el **token**. Invítalo al servidor con scopes `bot` + `applications.commands` y permiso **Send Messages / Embed Links / Attach Files** en el canal de ventas.
2. Sube la carpeta `bot/` a un repositorio (puede ser la misma con *Root Directory = bot*).
3. Render → New → **Web Service** → tu repo → Root Directory `bot` → Build `npm install` → Start `npm start`.
4. Variables (ver `bot/.env.example`): `DISCORD_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `SALES_CHANNEL_ID` (ya viene 1556033428099432479), opcional `GUILD_ID`.
5. Para que no se duerma en el plan gratis: crea un monitor en https://uptimerobot.com que llame cada 5 min a la URL de Render (responde `ok`). Aunque se durmiera, los pedidos quedan en cola y se entregan al despertar.

## 5. Cómo funciona la seguridad
- Los precios, cupones y ofertas se recalculan SIEMPRE en el servidor; el navegador solo envía IDs.
- Cada pago tiene su propio secreto de webhook; se verifica la firma HMAC (V2), la ventana de 5 min, el importe y la moneda, y se evitan duplicados.
- Las licencias solo se conceden cuando el webhook firmado confirma el pago.
- Los archivos están en un bucket privado; la descarga exige sesión de Discord de la cuenta propietaria, token aleatorio (solo se guarda su hash) que caduca a los 5 min, máx. 10 intentos y URLs firmadas de 90 s.
- Login con `state` anti-CSRF, cookies httpOnly, límites de peticiones, cabeceras anti-CSRF en el carrito y el panel.

## 6. Importante
- El secreto de Roblox (`ROBLOX_GAME_SECRET`) debe ser nuevo si estuvo en GitHub.
- Vuelve a publicar los productos con archivos subidos en Management Area → Products para que el botón Descargar funcione.
- No he podido probar pagos reales ni el bot contra tus cuentas: haz una compra de prueba en modo Test antes de abrir al público.


---
# Actualización v5 (qué cambió y qué hacer)

1. **Supabase:** ejecuta de nuevo TODO `supabase-setup.sql` (nuevo bloque v5: tablas/columnas de errores, fechas de promoción, ajustes del bot y avisos).
2. **Vercel:** sube el proyecto (`git push`). No hay variables nuevas.
3. **Render:** sube también la carpeta `bot/` actualizada (lleva un archivo nuevo `embed-defaults.js`). Variables igual que antes.
4. **Panel → Bot Configuration:** ahí editas todos los embeds (color de línea, título, cuerpo, imagen, miniatura, footer, hora, botón de enlace, activar/desactivar) y el estado del bot (Watching/Playing/...). Se aplican en segundos. Discord solo permite cambiar el color de la línea lateral; el color del título/cuerpo no es posible.
5. **Flujo de pago:** `yourorder.html` → "Purchase details" (Discord/Roblox/correo, casilla de términos) → "Continue to payment" abre Shoppex en pestaña nueva. La venta solo figura *Pending* mientras esa página sigue abierta; si se cierra/refresca pasa a *Not completed*. Los códigos de error están en `ERROR_CODES.md`.
6. **Correo/ticket de Shoppex:** la web envía a Shoppex el correo de la compra; el recibo por correo lo manda Shoppex. Actívalo en tu panel de Shoppex (ajustes de emails/notificaciones al cliente). Además el bot envía el recibo .txt por MD.
7. **Descargas:** si un producto no tiene archivos subidos ahora sale un mensaje claro ("does not have any files yet"). Sube archivos en Management Area → Product editor. Un solo archivo se descarga directamente; varios, de uno en uno con lista visible.
8. **Textos legales:** `terms.html` es un texto base: revísalo y adáptalo.
9. Si un botón del panel falla, ahora el mensaje incluye el motivo técnico entre corchetes [ ]: mándamelo y lo corrijo.

---
# Actualización v6

- **Botones del panel / descargas / "The page c... is not valid JSON":** las llamadas con varios tramos (`/api/admin/users/ID/licenses`, `/api/shop/download/token`...) devolvían el 404 de Vercel. Ahora todas las páginas las envían en formato de un solo tramo (`/api/admin/users?_p=ID/licenses`) y el servidor las entiende igual. Historial, Licencias, Ver (ticket), Dar, Editar, Bloquear, Eliminar y las descargas usan este formato.
- **Recibo (.txt) editable:** Bot Configuration → "Sale completed (DM...)" → nombre del archivo y contenido del recibo, con variables (`{order}`, `{items}`, `{receiptItems}`, `{dateText}`, `{total}`...).
- Sube de nuevo `bot/` a Render (cambió `index.js` y `embed-defaults.js`).
