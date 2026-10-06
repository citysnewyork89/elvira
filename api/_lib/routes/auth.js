// /api/auth/discord/login, /api/auth/discord/callback, /api/auth/logout
import jwt from 'jsonwebtoken';
import { serialize, parse } from 'cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { supabase, likeExact } from '../db.js';


function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

// Only our own pages may be used as a "return to" target after login.
const NEXT_PAGES = new Set(['/yourorder.html', '/ordercompleted.html', '/download.html', '/dashboard.html', '/store.html', '/product.html', '/index.html']);
export function safeNext(value) {
  const v = String(value || '').slice(0, 300);
  if (!/^\/[A-Za-z0-9._~\-]+\.html(\?[A-Za-z0-9._~:/?#=&%\-]*)?$/.test(v)) return '';
  return NEXT_PAGES.has(v.split('?')[0]) ? v : '';
}

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };

function sameString(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function discordLogin(req, res, query) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_REDIRECT_URI) {
    console.error('Discord login is not configured (DISCORD_CLIENT_ID / DISCORD_REDIRECT_URI).');
    return redirect(res, '/index.html?login_error=1');
  }
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    prompt: 'consent'
  });
  // Anti login-CSRF: a random "state" that must come back unchanged.
  const state = randomBytes(24).toString('base64url');
  params.set('state', state);
  const cookies = [serialize('elvira_oauth_state', state, { ...cookieOpts, maxAge: 600 })];
  const next = safeNext(query && query.next);
  if (next) cookies.push(serialize('elvira_next', next, { ...cookieOpts, maxAge: 1800 }));
  res.setHeader('Set-Cookie', cookies);
  redirect(res, `https://discord.com/api/oauth2/authorize?${params.toString()}`);
}

async function discordCallback(req, res, query) {
  const { code, error } = query;
  if (error || !code) return redirect(res, '/index.html?login_error=1');
  const jar = parse(req.headers.cookie || '');
  if (!sameString(jar.elvira_oauth_state, query.state)) return redirect(res, '/index.html?login_error=1');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Discord token exchange failed');

    const profileRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await profileRes.json();
    if (!discordUser.id) throw new Error('Could not read the Discord profile');

    const discordUsername =
      discordUser.discriminator && discordUser.discriminator !== '0'
        ? `${discordUser.username}#${discordUser.discriminator}`
        : discordUser.username;

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${Number(discordUser.discriminator || 0) % 5}.png`;

    let { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('discord_id', discordUser.id)
      .maybeSingle();

    // An admin may have created this person's account beforehand (by Discord
    // username). The first time they log in, they claim that account.
    if (!existing) {
      const { data: precreated } = await supabase
        .from('users')
        .select('*')
        .is('discord_id', null)
        .ilike('discord_username', likeExact(discordUsername))
        .maybeSingle();
      if (precreated) existing = precreated;
    }

    let userRow;
    if (existing) {
      const { data, error: updateError } = await supabase
        .from('users')
        .update({
          discord_id: discordUser.id,
          discord_username: discordUsername,
          // Only take the email from Discord if we don't have one yet, so an
          // email the user (or an admin) edited is never overwritten on login.
          email: existing.email || discordUser.email || null,
          avatar_url: avatarUrl
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (updateError) throw updateError;
      userRow = data;
    } else {
      const { data, error: insertError } = await supabase
        .from('users')
        .insert({
          discord_id: discordUser.id,
          discord_username: discordUsername,
          email: discordUser.email,
          avatar_url: avatarUrl
        })
        .select()
        .single();
      if (insertError) throw insertError;
      userRow = data;
    }

    const sessionToken = jwt.sign({ discordId: discordUser.id }, process.env.SESSION_SECRET, {
      expiresIn: '30d'
    });

    const next = safeNext(jar.elvira_next);
    const cookies = [
      serialize('elvira_session', sessionToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 }),
      serialize('elvira_oauth_state', '', { ...cookieOpts, expires: new Date(0) })
    ];

    let redirectTo = userRow.roblox_id ? next || '/dashboard.html' : '/onboarding.html';
    if (userRow.roblox_id && next) cookies.push(serialize('elvira_next', '', { ...cookieOpts, expires: new Date(0) }));
    if (userRow.blocked) redirectTo = '/block.html';
    res.setHeader('Set-Cookie', cookies);
    redirect(res, redirectTo);
  } catch (err) {
    console.error('Discord callback error:', err);
    redirect(res, '/index.html?login_error=1');
  }
}

function logout(req, res) {
  res.setHeader(
    'Set-Cookie',
    serialize('elvira_session', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0)
    })
  );
  redirect(res, '/index.html');
}

// GET /api/auth/next — returns (and clears) the page to go back to after Roblox verification.
function consumeNext(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const next = safeNext(parse(req.headers.cookie || '').elvira_next);
  if (next) res.setHeader('Set-Cookie', serialize('elvira_next', '', { ...cookieOpts, expires: new Date(0) }));
  res.status(200).json({ next });
}

export async function handleAuth(req, res, parts, query) {
  const route = parts.join('/');
  if (route === 'next') return consumeNext(req, res);
  if (route === 'discord/login') return discordLogin(req, res, query);
  if (route === 'discord/callback') return discordCallback(req, res, query);
  if (route === 'logout') return logout(req, res);
  res.status(404).json({ error: 'Not found' });
}

