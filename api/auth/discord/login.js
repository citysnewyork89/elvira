// Explicit route for /api/auth/discord/login (works even if catch-all routing misbehaves).
import { handleAuth } from '../../_lib/routes/auth.js';
import { queryParams } from '../../_lib/http.js';

export default async function handler(req, res) {
  return handleAuth(req, res, ['discord', 'login'], queryParams(req));
}
