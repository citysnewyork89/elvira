// /api/admin/users..., /api/admin/licenses/:id/transfer  (admin only)
import { supabase, likeExact } from '../db.js';
import { effectiveRole } from '../auth.js';
import { send, body, cleanText, UUID_RE } from '../http.js';
import { shapeSale, queueLicenseReceived } from '../shop-core.js';

export const ROLES = ['customer', 'staff', 'admin'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function formatOrder(n) {
  return n == null ? '' : 'EV-' + String(n).padStart(6, '0');
}

function shapeUser(u, paid) {
  return {
    id: u.id,
    discordUsername: u.discord_username,
    avatarUrl: u.avatar_url || '',
    robloxUsername: u.roblox_username || '',
    robloxVerified: !!u.roblox_id,
    email: u.email || '',
    role: effectiveRole(u),
    blocked: !!u.blocked,
    blockedReason: u.blocked_reason || '',
    createdAt: u.created_at,
    hasLoggedIn: !!u.discord_id,
    purchases: paid || 0
  };
}

function cleanDiscord(value) {
  return cleanText(value, 40).replace(/^@+/, '');
}

// Finds the one account for a Give / Transfer. Enter the Discord username, the
// Roblox username, or both (when both are given, both must match).
export async function findRecipient(discordUsername, robloxUsername) {
  const discord = cleanDiscord(discordUsername);
  const roblox = cleanText(robloxUsername, 40);
  if (!discord && !roblox) return { error: 'Enter the Discord username (and/or the Roblox username).' };

  let query = supabase.from('users').select('*');
  if (discord) query = query.ilike('discord_username', likeExact(discord));
  if (roblox) query = query.ilike('roblox_username', likeExact(roblox));
  const { data, error } = await query.limit(2);

  if (error) return { error: 'Could not look up that account right now.', status: 500 };
  if (!data || data.length === 0) {
    return { error: 'No Elvira account matches those usernames.', status: 404 };
  }
  if (data.length > 1) return { error: 'More than one account matches, please enter both usernames.', status: 409 };
  if (data[0].blocked) return { error: 'That account is blocked and cannot receive licenses.', status: 409 };
  return { user: data[0] };
}

async function listUsers(res) {
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) {
    console.error('List users error:', error);
    return send(res, 500, { error: 'Could not load users.' });
  }

  const { data: counts } = await supabase.from('user_purchase_counts').select('user_id, paid_count');
  const paidByUser = new Map((counts || []).map((row) => [row.user_id, Number(row.paid_count) || 0]));

  send(res, 200, { users: users.map((u) => shapeUser(u, paidByUser.get(u.id))) });
}

async function createUser(req, res) {
  const b = body(req);
  const discord = cleanDiscord(b.discordUsername);
  const roblox = cleanText(b.robloxUsername, 40);
  const email = cleanText(b.email, 200);
  const role = ROLES.includes(b.role) ? b.role : 'customer';

  if (discord.length < 2) return send(res, 400, { error: 'Enter the Discord username.' });
  if (email && !EMAIL_REGEX.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });

  const { data: clash } = await supabase
    .from('users')
    .select('id')
    .ilike('discord_username', likeExact(discord))
    .limit(1);
  if (clash && clash.length) return send(res, 409, { error: 'A user with that Discord username already exists.' });

  const { data, error } = await supabase
    .from('users')
    .insert({
      discord_id: null,
      discord_username: discord,
      roblox_username: roblox || null,
      email: email || null,
      role,
      is_admin: role === 'admin'
    })
    .select()
    .single();
  if (error) {
    console.error('Create user error:', error);
    return send(res, 500, { error: 'Could not create the user.' });
  }
  send(res, 201, { user: shapeUser(data, 0) });
}

async function updateUser(req, res, id, me) {
  const b = body(req);
  const patch = {};

  if (b.discordUsername !== undefined) {
    const discord = cleanDiscord(b.discordUsername);
    if (discord.length < 2) return send(res, 400, { error: 'Enter the Discord username.' });
    const { data: clash } = await supabase
      .from('users')
      .select('id')
      .ilike('discord_username', likeExact(discord))
      .neq('id', id)
      .limit(1);
    if (clash && clash.length) return send(res, 409, { error: 'Another user already has that Discord username.' });
    patch.discord_username = discord;
  }

  if (b.robloxUsername !== undefined) {
    const roblox = cleanText(b.robloxUsername, 40);
    if (roblox) {
      patch.roblox_username = roblox;
    } else {
      // Clearing the Roblox username unlinks the account, so the person has to verify again.
      patch.roblox_username = null;
      patch.roblox_id = null;
    }
  }

  if (b.email !== undefined) {
    const email = cleanText(b.email, 200);
    if (email && !EMAIL_REGEX.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    patch.email = email || null;
  }

  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return send(res, 400, { error: 'Invalid role.' });
    if (id === me.id && b.role !== effectiveRole(me)) {
      return send(res, 400, { error: "You can't change your own role." });
    }
    patch.role = b.role;
    patch.is_admin = b.role === 'admin';
  }

  if (!Object.keys(patch).length) return send(res, 400, { error: 'Nothing to update.' });

  const { data, error } = await supabase.from('users').update(patch).eq('id', id).select().maybeSingle();
  if (error) {
    console.error('Update user error:', error);
    const taken = error.code === '23505';
    return send(res, taken ? 409 : 500, {
      error: taken ? 'That Roblox account is already linked to another user.' : 'Could not save the changes.'
    });
  }
  if (!data) return send(res, 404, { error: 'User not found.' });
  send(res, 200, { user: shapeUser(data) });
}

async function deleteUser(res, id, me) {
  if (id === me.id) return send(res, 400, { error: "You can't delete your own account." });
  const { data, error } = await supabase.from('users').delete().eq('id', id).select('id');
  if (error) {
    console.error('Delete user error:', error);
    return send(res, 500, { error: 'Could not delete the account.' });
  }
  if (!data || !data.length) return send(res, 404, { error: 'User not found.' });
  send(res, 200, { success: true });
}

async function setBlocked(req, res, id, me, blocked) {
  if (blocked) {
    if (id === me.id) return send(res, 400, { error: "You can't block yourself." });
    const reason = cleanText(body(req).reason, 500);
    if (!reason) return send(res, 400, { error: 'Please enter the reason for blocking this user.' });
    const { data, error } = await supabase
      .from('users')
      .update({ blocked: true, blocked_reason: reason, blocked_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) return send(res, 500, { error: 'Could not block the user.' });
    if (!data) return send(res, 404, { error: 'User not found.' });
    return send(res, 200, { user: shapeUser(data) });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ blocked: false, blocked_reason: null, blocked_at: null })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return send(res, 500, { error: 'Could not unblock the user.' });
  if (!data) return send(res, 404, { error: 'User not found.' });
  send(res, 200, { user: shapeUser(data) });
}

async function userPurchases(res, id) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return send(res, 500, { error: 'Could not load the purchase history.' });
  const { data: buyer } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  send(res, 200, { purchases: (data || []).map((p) => shapeSale(p, buyer)) });
}

async function userLicenses(res, id) {
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', id)
    .order('acquired_at', { ascending: false })
    .limit(500);
  if (error) return send(res, 500, { error: 'Could not load the licenses.' });

  send(res, 200, {
    licenses: (data || []).map((l) => ({
      id: l.id,
      productId: l.product_id,
      productName: l.product_name,
      acquiredAt: l.acquired_at,
      orderNumber: formatOrder(l.order_number),
      source: l.source
    }))
  });
}

export async function handleUsers(req, res, parts, me) {
  const id = parts[1];
  const action = parts[2];

  if (!id) {
    if (req.method === 'GET') return listUsers(res);
    if (req.method === 'POST') return createUser(req, res);
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (!UUID_RE.test(id)) return send(res, 400, { error: 'Invalid user id.' });

  if (!action) {
    if (req.method === 'PATCH' || req.method === 'PUT') return updateUser(req, res, id, me);
    if (req.method === 'DELETE') return deleteUser(res, id, me);
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (action === 'block' && req.method === 'POST') return setBlocked(req, res, id, me, true);
  if (action === 'unblock' && req.method === 'POST') return setBlocked(req, res, id, me, false);
  if (action === 'purchases' && req.method === 'GET') return userPurchases(res, id);
  if (action === 'licenses' && req.method === 'GET') return userLicenses(res, id);

  send(res, 404, { error: 'Not found' });
}

// POST /api/admin/licenses/:id/transfer { discordUsername, robloxUsername }
export async function handleLicenses(req, res, parts) {
  const id = parts[1];
  if (!id || !UUID_RE.test(id) || parts[2] !== 'transfer' || req.method !== 'POST') {
    return send(res, 404, { error: 'Not found' });
  }

  const { data: license, error } = await supabase.from('licenses').select('*').eq('id', id).maybeSingle();
  if (error) return send(res, 500, { error: 'Could not load the license.' });
  if (!license) return send(res, 404, { error: 'License not found.' });

  const found = await findRecipient(body(req).discordUsername, body(req).robloxUsername);
  if (found.error) return send(res, found.status || 400, { error: found.error });
  const recipient = found.user;

  if (recipient.id === license.user_id) {
    return send(res, 400, { error: 'That account already owns this license.' });
  }

  if (license.product_id) {
    const { data: dup } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', recipient.id)
      .eq('product_id', license.product_id)
      .limit(1);
    if (dup && dup.length) return send(res, 409, { error: 'That account already owns this product.' });
  }

  const { data: previous } = await supabase
    .from('users')
    .select('discord_username')
    .eq('id', license.user_id)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from('licenses')
    .update({
      user_id: recipient.id,
      source: 'transfer',
      transferred_from: previous ? previous.discord_username : null,
      transferred_at: new Date().toISOString()
    })
    .eq('id', id);
  if (updateError) {
    console.error('Transfer license error:', updateError);
    return send(res, 500, { error: 'Could not transfer the license.', detail: updateError.message });
  }
  await queueLicenseReceived({ userId: recipient.id, productId: license.product_id, licenseId: id, productName: license.product_name, source: 'transfer', grantedBy: previous ? previous.discord_username : '' });

  send(res, 200, { success: true, recipient: recipient.discord_username });
}
