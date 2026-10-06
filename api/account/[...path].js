// One serverless function for every /api/account/* URL.
import { handleAccount } from '../_lib/routes/account.js';
import { pathParts } from '../_lib/http.js';

export default async function handler(req, res) {
  return handleAccount(req, res, pathParts(req, '/api/account'));
}
