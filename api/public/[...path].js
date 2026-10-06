// One serverless function for every /api/public/* URL (the storefront).
import { handlePublic } from '../_lib/routes/public.js';
import { pathParts, queryParams } from '../_lib/http.js';

export default async function handler(req, res) {
  try {
    return await handlePublic(req, res, pathParts(req, '/api/public'), queryParams(req));
  } catch (err) {
    console.error('Public API error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
