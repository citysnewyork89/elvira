// Session + role helpers used by every router.
import jwt from 'jsonwebtoken';
import { parse } from 'cookie';
import { supabase } from './db.js';
import { send } from './http.js';

// Roles: customer (default) < staff < admin.
// The old is_admin flag keeps working: is_admin = true means admin.
export function effectiveRole(user) {
  if (!user) return 'customer';
  if (user.role === 'admin' || user.is_admin) return 'admin';
  if (user.role === 'staff') return 'staff';
  return 'customer';
}

export function readSession(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null; // refuse to work with a missing/weak secret
  const token = parse(req.headers.cookie || '').elvira_session;
  if (!token || token.length > 2000) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!payload || typeof payload.discordId !== 'string' || !payload.discordId) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

export async function getSessionUser(req) {
  const payload = readSession(req);
  if (!payload) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', payload.discordId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// Returns the user row if they are logged in, not blocked and have one of the
// given roles. Otherwise it already answered the request and returns null.
// The role is ALWAYS re-read from the database — never trusted from the cookie.
export async function requireRole(req, res, roles, onDenied) {
  const user = await getSessionUser(req);
  if (!user) {
    if (onDenied) onDenied('anonymous');
    send(res, 401, { error: 'Not logged in' });
    return null;
  }
  if (user.blocked) {
    if (onDenied) onDenied('blocked', user);
    send(res, 403, { error: 'Forbidden', blocked: true });
    return null;
  }
  if (!roles.includes(effectiveRole(user))) {
    if (onDenied) onDenied('role', user);
    // Same answer as an unknown URL: don't confirm that admin tools exist.
    send(res, 404, { error: 'Not found' });
    return null;
  }
  return user;
}
