// Small admin endpoints: overview stats, hub info, signed upload URLs.
import { randomUUID } from 'node:crypto';
import { supabase, MEDIA_BUCKET, FILES_BUCKET } from '../db.js';
import { effectiveRole } from '../auth.js';
import { send, body, cleanText } from '../http.js';

export async function handleOverview(res, me) {
  const role = effectiveRole(me);
  const profile = {
    discordUsername: me.discord_username,
    robloxUsername: me.roblox_username || '',
    email: me.email || '',
    avatarUrl: me.avatar_url || '',
    role,
    memberSince: me.created_at
  };
  if (role !== 'admin') return send(res, 200, { profile, stats: null });

  // Each query is allowed to fail on its own (e.g. a table that was not created yet)
  // without breaking the whole overview.
  const safe = (promise) => Promise.resolve(promise).catch(() => ({ data: null, count: 0, error: true }));
  const [users, products, publicProducts, paid] = await Promise.all([
    safe(supabase.from('users').select('id', { count: 'exact', head: true })),
    safe(supabase.from('products').select('id', { count: 'exact', head: true })),
    safe(supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'public')),
    safe(supabase.from('purchases').select('amount_eur').eq('status', 'paid').limit(10000))
  ]);

  const revenue = (paid.data || []).reduce((sum, row) => sum + (Number(row.amount_eur) || 0), 0);
  send(res, 200, {
    profile,
    stats: {
      users: users.count || 0,
      products: products.count || 0,
      publicProducts: publicProducts.count || 0,
      paidOrders: (paid.data || []).length,
      revenue: Math.round(revenue * 100) / 100
    }
  });
}

export async function handleHubInfo(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('hub_info').select('*').eq('id', 1).maybeSingle();
    if (error) return send(res, 500, { error: 'Could not load hub info' });
    return send(res, 200, {
      title: (data && data.title) || '',
      message: (data && data.message) || '',
      requireAck: !data || data.require_ack !== false,
      active: !!(data && data.active)
    });
  }

  if (req.method === 'POST') {
    const { title, message, requireAck, active } = body(req);
    if (typeof title !== 'string' || typeof message !== 'string') {
      return send(res, 400, { error: 'Title and message are required.' });
    }
    const { error } = await supabase.from('hub_info').upsert(
      {
        id: 1,
        title: title.trim(),
        message: message.trim(),
        require_ack: requireAck !== false,
        active: active === true,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
    if (error) return send(res, 500, { error: 'Could not save hub info' });
    return send(res, 200, { success: true });
  }

  send(res, 405, { error: 'Method not allowed' });
}

// POST /api/admin/upload-url { bucket: "media" | "files", filename, contentType }
// Files go straight from the browser to Supabase Storage (Vercel functions
// can't receive large uploads), using a one-time signed upload URL.
export async function handleUploadUrl(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const b = body(req);
  const isMedia = b.bucket === 'media';
  if (!isMedia && b.bucket !== 'files') return send(res, 400, { error: 'Invalid upload type.' });

  const contentType = cleanText(b.contentType, 120).toLowerCase();
  if (isMedia && !/^(image|video)\//.test(contentType)) {
    return send(res, 400, { error: 'Only images and videos can be uploaded here.' });
  }

  const safeName =
    String(b.filename || 'file')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .slice(-100) || 'file';
  const path = `${randomUUID()}/${safeName}`;

  const { data, error } = await supabase.storage
    .from(isMedia ? MEDIA_BUCKET : FILES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error('Signed upload URL error:', error);
    return send(res, 500, { error: 'Could not prepare the upload. Check that the storage buckets exist.' });
  }

  send(res, 200, {
    path,
    signedUrl: data.signedUrl,
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY || null
  });
}

// GET /api/admin/health — admin only. Tells the admin what is missing in the
// setup (tables, storage buckets, server settings) without exposing any value.
export async function handleHealth(res) {
  const problems = [];
  const env = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET: !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16,
    ROBLOX_GAME_SECRET: !!process.env.ROBLOX_GAME_SECRET
  };
  for (const [name, ok] of Object.entries(env)) if (!ok) problems.push('Missing or weak server setting: ' + name);

  const tables = ['users', 'products', 'purchases', 'licenses', 'promotions', 'site_settings', 'hub_info', 'user_purchase_counts'];
  const checks = await Promise.all(
    tables.map(async (t) => {
      try {
        const { error } = await supabase.from(t).select('*').limit(1);
        return error ? t : null;
      } catch (e) {
        return t;
      }
    })
  );
  checks.filter(Boolean).forEach((t) => problems.push('Database table/view not available: ' + t + ' (run supabase-setup.sql in Supabase)'));

  const needs = [
    ['purchases', 'order_code,customer_email,subtotal_eur,buyer_ip,last_seen_at,expires_at,failure_code,terms_accepted_at,order_ip_changed,events,provider'],
    ['promotions', 'ends_at'], ['bot_events', 'payload'], ['bot_settings', 'id'], ['order_secrets', 'webhook_secret'],
    ['processed_webhooks', 'delivery_id'], ['download_tokens', 'token_hash']
  ];
  for (const [table, cols] of needs) {
    try {
      const { error } = await supabase.from(table).select(cols).limit(1);
      if (error) problems.push(`Database is out of date: ${table} (${error.message}). Run supabase-fix-v5.sql in Supabase.`);
    } catch (e) {
      problems.push(`Database is out of date: ${table}. Run supabase-fix-v5.sql in Supabase.`);
    }
  }
  if (!process.env.SHOPPEX_API_KEY) problems.push('Missing server setting: SHOPPEX_API_KEY (payments will fail)');
  if (!process.env.SITE_URL) problems.push('Missing server setting: SITE_URL (set it to https://your-domain)');

  try {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) problems.push('Storage buckets could not be checked');
    else {
      const names = (data || []).map((b) => b.name);
      if (!names.includes(MEDIA_BUCKET)) problems.push('Storage bucket missing: ' + MEDIA_BUCKET);
      if (!names.includes(FILES_BUCKET)) problems.push('Storage bucket missing: ' + FILES_BUCKET);
    }
  } catch (e) {
    problems.push('Storage buckets could not be checked');
  }

  send(res, 200, { ok: problems.length === 0, problems });
}
