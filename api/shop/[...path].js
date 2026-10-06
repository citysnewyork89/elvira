// One serverless function for every /api/shop/* URL (checkout, webhook, licenses, downloads).
// Body parsing is disabled so the Shoppex webhook signature can be checked against the raw bytes.
import { handleShop } from '../_lib/routes/shop.js';
import { pathParts, queryParams } from '../_lib/http.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  try {
    return await handleShop(req, res, pathParts(req, '/api/shop'), queryParams(req));
  } catch (err) {
    console.error('Shop API error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
