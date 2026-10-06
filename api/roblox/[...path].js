// One serverless function for every /api/roblox/* URL (used by the website
// AND by the Roblox game's server script — the URLs did not change).
import { handleRoblox } from '../_lib/routes/roblox.js';
import { pathParts, queryParams } from '../_lib/http.js';

export default async function handler(req, res) {
  return handleRoblox(req, res, pathParts(req, '/api/roblox'), queryParams(req));
}
