// /api/account/update-email
import { supabase } from '../db.js';
import { getSessionUser } from '../auth.js';
import { send, body } from '../http.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function updateEmail(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return send(res, 401, { error: 'Not logged in' });
  if (user.blocked) return send(res, 403, { error: 'Your account is blocked' });

  const email = body(req).email ? String(body(req).email).trim() : '';
  if (!EMAIL_REGEX.test(email)) {
    return send(res, 400, { error: 'Please enter a valid email address' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ email })
    .eq('id', user.id)
    .select()
    .single();

  if (error) return send(res, 500, { error: 'Could not update your email right now' });
  send(res, 200, { success: true, email: data.email });
}

export async function handleAccount(req, res, parts) {
  if (parts.join('/') === 'update-email') return updateEmail(req, res);
  res.status(404).json({ error: 'Not found' });
}
