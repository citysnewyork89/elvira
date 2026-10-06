// Serves the private admin pages (Management Area + product editor).
// The HTML is only ever sent to a logged-in, non-blocked admin/staff account
// (checked against the database). Everyone else gets the same 404 page as any
// URL that doesn't exist, so the code of these pages is never public.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSessionUser, effectiveRole } from './_lib/auth.js';
import { clientIp, hit, tooMany } from './_lib/guard.js';

const PAGES = {
  managementarea: { file: 'managementarea.html', roles: ['admin', 'staff'] },
  'product-editor': { file: 'product-editor.html', roles: ['admin'] }
};

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>404 – Page not found</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;background:#fff;color:#2d2d2d;text-align:center}h1{font-size:64px;margin:0}p{color:#666}a{color:#2d2d2d}</style></head><body><div><h1>404</h1><p>This page could not be found.</p><a href="/index.html">Back to home</a></div></body></html>`;

function notFound(res) {
  res.status(404);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(NOT_FOUND);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    if (hit('page:' + clientIp(req), 120, 60 * 1000)) return tooMany(res);

    const name = String((req.query && req.query.name) || '');
    const page = Object.prototype.hasOwnProperty.call(PAGES, name) ? PAGES[name] : null;
    if (!page) return notFound(res);

    const user = await getSessionUser(req);
    if (!user || user.blocked || !page.roles.includes(effectiveRole(user))) return notFound(res);

    const html = await readFile(path.join(process.cwd(), 'api', '_private', page.file), 'utf8');
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(html);
  } catch (err) {
    console.error('Private page error:', err);
    if (!res.headersSent) notFound(res);
  }
}
