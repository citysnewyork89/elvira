// One serverless function for every /api/auth/* URL (Vercel's free plan allows
// only 12 functions, so related endpoints are grouped behind small routers).
import { handleAuth } from '../_lib/routes/auth.js';
import { pathParts, queryParams } from '../_lib/http.js';

export default async function handler(req, res) {
  return handleAuth(req, res, pathParts(req, '/api/auth'), queryParams(req));
}
