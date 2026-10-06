// Security helpers for the admin API and the private pages.
import { supabase } from './db.js';

export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '') || 'unknown';
}

export function apiHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

// Requests must come from this same site. Browsers add Origin / Sec-Fetch-Site
// themselves and pages cannot forge them.
export function sameOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch (e) {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

// Custom header that only our own pages send. A different website cannot add
// it to a request without our permission (that would need a CORS preflight,
// which this API never allows), so this blocks cross-site request forgery.
export function hasAdminHeader(req) {
  return req.headers['x-requested-with'] === 'elvira-admin';
}

// ---------- tiny in-memory rate limiter (per server instance) ----------
const buckets = new Map();
export function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return b.count > limit;
}

// Read a counter without adding to it.
export function isOver(key, limit) {
  const b = buckets.get(key);
  return !!b && b.reset > Date.now() && b.count > limit;
}

export function tooMany(res) {
  res.setHeader('Retry-After', '60');
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
}

// Best-effort audit trail: who did what (never the request body).
export async function audit(me, action, target) {
  const line = { at: new Date().toISOString(), by: me && me.discord_username, action, target };
  console.log('[admin-audit]', JSON.stringify(line));
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: me && me.id,
      admin_name: me && me.discord_username,
      action,
      target: target || null
    });
  } catch (err) {
    /* table is optional */
  }
}
