// One serverless function for every /api/admin/* URL.
//   overview                 admin + staff
//   everything else          admin only
// Every request must: come from this site, carry the admin header (writes),
// be inside the rate limit, and belong to a logged-in, non-blocked admin whose
// role is re-checked in the database. Route modules are loaded on demand so a
// problem in one of them can never take the whole admin API down.
import { requireRole } from '../_lib/auth.js';
import { pathParts, queryParams, send } from '../_lib/http.js';
import { apiHeaders, sameOrigin, hasAdminHeader, clientIp, hit, isOver, tooMany, audit } from '../_lib/guard.js';

const LOADERS = {
  users: () => import('../_lib/routes/admin-users.js'),
  licenses: () => import('../_lib/routes/admin-users.js'),
  products: () => import('../_lib/routes/admin-products.js'),
  promotions: () => import('../_lib/routes/admin-promotions.js'),
  sales: () => import('../_lib/routes/admin-sales.js'),
  bot: () => import('../_lib/routes/admin-bot.js'),
  site: () => import('../_lib/routes/site-config.js'),
  'hub-info': () => import('../_lib/routes/admin-misc.js'),
  'upload-url': () => import('../_lib/routes/admin-misc.js'),
  overview: () => import('../_lib/routes/admin-misc.js'),
  health: () => import('../_lib/routes/admin-misc.js')
};

const READ = new Set(['GET', 'HEAD']);
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default async function handler(req, res) {
  apiHeaders(res);

  try {
    const method = String(req.method || 'GET').toUpperCase();
    if (!READ.has(method) && !WRITE.has(method)) return send(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Forbidden' });
    if (WRITE.has(method) && !hasAdminHeader(req)) return send(res, 403, { error: 'Forbidden' });

    const ip = clientIp(req);
    if (hit('adm:' + ip, method === 'GET' ? 300 : 90, 60 * 1000)) return tooMany(res);
    const parts = pathParts(req, '/api/admin');
    const resource = parts[0];
    const loader = LOADERS[resource];
    if (!loader) {
      // Unknown URL: still require a valid admin session so nothing is revealed.
      const who = await requireRole(req, res, ['admin', 'staff']);
      if (!who) return;
      return send(res, 404, { error: 'Not found' });
    }

    const onDenied = (why, user) => {
      hit('denied:' + ip, 40, 10 * 60 * 1000);
      console.warn('[admin-denied]', why, user ? user.id : '-', ip, method, resource);
    };
    // Repeated denied attempts (wrong role / no session) lock the IP out for a while.
    if (isOver('denied:' + ip, 40)) return tooMany(res);

    const allowed = resource === 'overview' ? ['admin', 'staff'] : ['admin'];
    const me = await requireRole(req, res, allowed, onDenied);
    if (!me) return;

    const mod = await loader();

    switch (resource) {
      case 'overview':
        return await mod.handleOverview(res, me);
      case 'health':
        return await mod.handleHealth(res);
      case 'users':
        await mod.handleUsers(req, res, parts, me);
        break;
      case 'licenses':
        await mod.handleLicenses(req, res, parts);
        break;
      case 'products':
        await mod.handleProducts(req, res, parts, me);
        break;
      case 'promotions':
        await mod.handlePromotions(req, res, parts);
        break;
      case 'bot':
        await mod.handleBot(req, res);
        break;
      case 'sales':
        await mod.handleSales(req, res, parts, queryParams(req));
        break;
      case 'site':
        await mod.handleSite(req, res);
        break;
      case 'hub-info':
        await mod.handleHubInfo(req, res);
        break;
      case 'upload-url':
        await mod.handleUploadUrl(req, res);
        break;
      default:
        return send(res, 404, { error: 'Not found' });
    }

    if (WRITE.has(method) && res.statusCode < 400) {
      await audit(me, method + ' ' + resource, parts.slice(1).join('/'));
    }
  } catch (err) {
    console.error('Admin API error:', err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please try again.', detail: String((err && err.message) || err).slice(0, 300) });
  }
}
