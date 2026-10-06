// Everything the website and the Roblox game use to link a Roblox account.
//   GET  /api/roblox/code/generate     (website, logged in)
//   POST /api/roblox/code/redeem       (Roblox game server, shared secret)
//   GET  /api/roblox/status?robloxId=  (Roblox game server, shared secret)
//   GET  /api/roblox/hub-info          (Roblox game server, shared secret)
//   GET  /api/roblox/verify/start      (legacy Roblox OAuth)
//   GET  /api/roblox/verify/callback   (legacy Roblox OAuth)
import { randomInt, timingSafeEqual } from 'node:crypto';
import { supabase } from '../db.js';
import { readSession } from '../auth.js';
import { send, body } from '../http.js';

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function hasGameSecret(req) {
  const secret = req.headers['x-elvira-secret'];
  const expected = process.env.ROBLOX_GAME_SECRET;
  if (!secret || !expected || typeof secret !== 'string') return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function randomSixDigitCode() {
  return String(randomInt(100000, 1000000));
}

async function generateCode(req, res) {
  const session = readSession(req);
  if (!session) return send(res, 401, { error: 'Not logged in' });

  const code = randomSixDigitCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('verification_codes')
    .upsert({ discord_id: session.discordId, code, expires_at: expiresAt }, { onConflict: 'discord_id' });

  if (error) {
    console.error('Generate code error:', error);
    return send(res, 500, { error: 'Could not generate a code right now' });
  }
  send(res, 200, { code, expiresAt });
}

async function redeemCode(req, res) {
  if (req.method !== 'POST') return send(res, 405, { success: false, message: 'Method not allowed' });
  if (!hasGameSecret(req)) return send(res, 401, { success: false, message: 'Unauthorized' });

  const { code, robloxId, robloxUsername } = body(req);
  const cleanCode = code ? String(code).trim() : '';

  if (!/^\d{6}$/.test(cleanCode) || !robloxId || !robloxUsername) {
    return send(res, 400, { success: false, message: 'Missing or invalid code/account info.' });
  }

  const { data: entry, error: lookupError } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('code', cleanCode)
    .maybeSingle();

  if (lookupError || !entry) {
    return send(res, 200, {
      success: false,
      message: 'That code is invalid. Please generate a new one on the website.'
    });
  }

  if (new Date(entry.expires_at).getTime() < Date.now()) {
    return send(res, 200, {
      success: false,
      message: 'That code has expired. Please generate a new one on the website.'
    });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ roblox_id: String(robloxId), roblox_username: robloxUsername })
    .eq('discord_id', entry.discord_id);

  if (updateError) {
    const alreadyLinked = updateError.code === '23505'; // unique constraint on roblox_id
    return send(res, 200, {
      success: false,
      message: alreadyLinked
        ? 'This Roblox account is already linked to another Elvira account.'
        : 'Something went wrong while linking your account. Please try again.'
    });
  }

  await supabase.from('verification_codes').delete().eq('discord_id', entry.discord_id);

  send(res, 200, {
    success: true,
    message: 'Your Roblox account is now linked! You can go back to the website.'
  });
}

async function status(req, res, query) {
  if (!hasGameSecret(req)) return send(res, 401, { linked: false });

  const { robloxId } = query;
  if (!robloxId) return send(res, 400, { linked: false });

  const { data: user, error } = await supabase
    .from('users')
    .select('discord_username')
    .eq('roblox_id', String(robloxId))
    .maybeSingle();

  if (error || !user) return send(res, 200, { linked: false });
  send(res, 200, { linked: true, discordUsername: user.discord_username });
}

async function hubInfo(req, res) {
  if (!hasGameSecret(req)) return send(res, 401, { active: false });

  const { data, error } = await supabase.from('hub_info').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return send(res, 200, { active: false });

  send(res, 200, {
    active: !!data.active,
    title: data.title || '',
    message: data.message || '',
    requireAck: data.require_ack !== false
  });
}

function verifyStart(req, res) {
  if (!readSession(req)) return redirect(res, '/index.html');

  const params = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID,
    redirect_uri: process.env.ROBLOX_REDIRECT_URI,
    scope: 'openid profile',
    response_type: 'code'
  });
  redirect(res, `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`);
}

async function verifyCallback(req, res, query) {
  const fail = (message) =>
    redirect(res, `/onboarding.html?status=error&message=${encodeURIComponent(message)}`);

  const session = readSession(req);
  if (!session) return fail('You must be logged in with Discord first.');

  const { code, error: robloxError } = query;
  if (robloxError) return fail('The Roblox verification was cancelled.');
  if (!code) return fail('Missing authorization code from Roblox.');

  try {
    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.ROBLOX_CLIENT_ID,
        client_secret: process.env.ROBLOX_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.ROBLOX_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return fail('Roblox did not return a valid token.');

    const userRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const robloxUser = await userRes.json();
    const robloxUsername = robloxUser.preferred_username || robloxUser.nickname || robloxUser.name;

    if (!robloxUsername || !robloxUser.sub) return fail('Could not read your Roblox username.');

    const { error: updateError } = await supabase
      .from('users')
      .update({ roblox_id: robloxUser.sub, roblox_username: robloxUsername })
      .eq('discord_id', session.discordId);

    if (updateError) return fail('Could not save your Roblox account. Please try again.');

    redirect(res, '/onboarding.html?status=success');
  } catch (err) {
    console.error('Roblox callback error:', err);
    fail('Something went wrong while verifying your Roblox account.');
  }
}

export async function handleRoblox(req, res, parts, query) {
  const route = parts.join('/');
  if (route === 'code/generate') return generateCode(req, res);
  if (route === 'code/redeem') return redeemCode(req, res);
  if (route === 'status') return status(req, res, query);
  if (route === 'hub-info') return hubInfo(req, res);
  if (route === 'verify/start') return verifyStart(req, res);
  if (route === 'verify/callback') return verifyCallback(req, res, query);
  res.status(404).json({ error: 'Not found' });
}
