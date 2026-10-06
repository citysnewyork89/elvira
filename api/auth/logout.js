// Explicit route for /api/auth/logout.
import { handleAuth } from '../_lib/routes/auth.js';
import { queryParams } from '../_lib/http.js';

export default async function handler(req, res) {
  return handleAuth(req, res, ['logout'], queryParams(req));
}
