// Tiny helpers shared by the API routers.
export function send(res, status, body) {
  res.status(status).json(body);
}

export function parsedUrl(req) {
  return new URL(req.url || '/', 'http://localhost');
}

// Path segments after a base, e.g. base "/api/admin" and URL
// "/api/admin/users/123/block?x=1" -> ["users", "123", "block"].
export function pathParts(req, base) {
  const url = parsedUrl(req);
  const pathname = url.pathname;
  const decode = (part) => {
    try {
      return decodeURIComponent(part);
    } catch (e) {
      return part;
    }
  };
  let parts;
  if (pathname.startsWith(base)) {
    parts = pathname.slice(base.length).split('/').filter(Boolean).map(decode);
  } else {
    // If a rewrite changed req.url, fall back to the catch-all value Vercel provides.
    const q = req.query && req.query.path;
    if (q !== undefined && q !== null && q !== '') {
      parts = (Array.isArray(q) ? q : String(q).split('/')).filter(Boolean).map(String);
    } else {
      parts = pathname.split('/').filter(Boolean).map(decode);
    }
  }
  // Our pages call "/api/admin/users?_p=<id>/purchases" instead of "/api/admin/users/<id>/purchases":
  // one URL segment always routes correctly on Vercel, deeper ones may not.
  const extra = url.searchParams.get('_p');
  if (extra) parts = parts.concat(extra.split('/').filter(Boolean).slice(0, 6));
  return parts;
}

export function queryParams(req) {
  const out = Object.fromEntries(parsedUrl(req).searchParams);
  delete out.path; // internal routing value added by rewrites
  delete out._p; // see pathParts
  return out;
}

export function body(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 500);
}

// Only allow http(s) links, or links to pages inside the site.
export function safeLink(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.slice(0, 500);
  if (/^\/[^/\\]/.test(value) || /^[a-z0-9_-]+\.html(\?[^\s]*)?(#[^\s]*)?$/i.test(value)) return value.slice(0, 500);
  return '';
}
