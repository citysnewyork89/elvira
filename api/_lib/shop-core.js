// Shared checkout logic: server-side pricing, order codes, download tokens,
// the Shoppex client, webhook signature check and order completion.
// NOTHING that comes from the browser is trusted for money: prices are always
// recomputed here from the database.
import { randomBytes, randomInt, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from './db.js';
import { applyDiscount } from './pricing.js';
import { UUID_RE } from './http.js';
import { errorText } from './error-codes.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DOWNLOAD_TTL_MS = 5 * 60 * 1000; // download links live 5 minutes
export const MAX_CART = 25;
export const STALE_MS = 90 * 1000;          // a pending order whose page stopped answering this long is "not completed"
export const ORDER_TTL_MS = 30 * 60 * 1000; // an order must be paid within 30 minutes
export const COUPON_REUSED_MSG = 'Sorry, this coupon code has already been redeemed by you.';

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const euros = (c) => Math.round(c) / 100;

// ---------- Codes and tokens ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function newOrderCode() {
  let s = '';
  for (let i = 0; i < 9; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
}

export function isOrderCode(value) {
  return /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(String(value || ''));
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function siteUrl(req) {
  const fromEnv = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(fromEnv)) return fromEnv;
  const host = String((req && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  return host ? 'https://' + host : '';
}

// ---------- Pricing ----------
// ids -> full quote (lines, offers, coupon, totals). Never trusts client prices.
export async function buildQuote({ ids, user, coupon, ip }) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => UUID_RE.test(id)).slice(0, MAX_CART);
  if (!list.length) return { error: 'Your order is empty.', status: 400 };

  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,media,price_eur,discount_type,discount_value,status')
    .in('id', list)
    .in('status', ['public', 'unlisted']);
  if (error) return { error: 'Could not load the products.', status: 500 };

  const byId = new Map((products || []).map((p) => [p.id, p]));
  if (list.some((id) => !byId.has(id))) {
    return { error: 'One of the products is no longer available.', status: 409 };
  }

  let ownedNames = [];
  if (user) {
    const { data: owned } = await supabase.from('licenses').select('product_id').eq('user_id', user.id).in('product_id', list);
    const ownedIds = new Set((owned || []).map((r) => r.product_id));
    ownedNames = list.filter((id) => ownedIds.has(id)).map((id) => byId.get(id).name);
  }

  const { data: promos } = await supabase.from('promotions').select('*').eq('active', true).limit(500);
  const allActive = promos || [];
  const nowMs = Date.now();
  const isLive = (p) => !p.ends_at || new Date(p.ends_at).getTime() > nowMs;
  const active = allActive.filter(isLive); // promotions past their end date can no longer be used

  let paidBefore = null;
  if (user && active.some((p) => p.type === 'first_purchase')) {
    const { count } = await supabase
      .from('purchases')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'paid');
    paidBefore = count || 0;
  }

  const lines = list.map((id) => {
    const p = byId.get(id);
    const media = Array.isArray(p.media) ? p.media : [];
    const image = media.find((m) => m.type === 'image');
    const original = toCents(p.price_eur);
    const unit = toCents(applyDiscount(p.price_eur, p.discount_type, p.discount_value));
    return {
      productId: id,
      name: p.name,
      image: image ? image.url : '',
      originalCents: original,
      unitCents: Math.min(unit, original),
      offerCents: 0,
      couponCents: 0,
      offerName: ''
    };
  });

  const cartIds = new Set(list);
  const sumUnits = lines.reduce((s, l) => s + l.unitCents, 0);
  const appliedOffers = new Map();

  for (const promo of active) {
    if (promo.type === 'coupon') continue;
    const cfg = promo.config || {};
    let ok = false;
    if (promo.type === 'first_purchase') ok = !!user && paidBefore === 0;
    else if (promo.type === 'buy_get') ok = (cfg.requiredProductIds || []).length > 0 && cfg.requiredProductIds.every((id) => cartIds.has(id));
    else if (promo.type === 'min_spend') ok = sumUnits >= toCents(cfg.minAmount);
    if (!ok) continue;
    const targets = new Set(cfg.targetProductIds || []);
    for (const line of lines) {
      if (!targets.has(line.productId)) continue;
      const after = toCents(applyDiscount(line.unitCents / 100, cfg.discountType, cfg.discountValue));
      const saved = line.unitCents - after;
      if (saved > line.offerCents) {
        line.offerCents = saved;
        line.offerName = promo.name;
      }
    }
  }
  for (const line of lines) if (line.offerCents > 0) appliedOffers.set(line.offerName, true);

  let couponInfo = null;
  let couponError = '';
  let couponBlocked = false;
  const code = String(coupon || '').trim().toUpperCase();
  if (code) {
    const found = allActive.find((p) => p.type === 'coupon' && String((p.config || {}).code || '').toUpperCase() === code);
    if (!found) couponError = 'That coupon code is not valid.';
    else if (!isLive(found)) couponError = 'This coupon code has expired.';
    else {
      // A coupon can be redeemed once per IP address: another account on the same IP cannot reuse it.
      if (ip && ip !== 'unknown') {
        let used = supabase.from('purchases').select('id').eq('discount_code', code).eq('buyer_ip', ip).eq('status', 'paid').limit(1);
        if (user) used = used.neq('user_id', user.id);
        const { data: rows } = await used;
        if (rows && rows.length) couponBlocked = true;
      }
      if (couponBlocked) couponError = COUPON_REUSED_MSG;
      else {
        const cfg = found.config || {};
        for (const line of lines) {
          const base = line.unitCents - line.offerCents;
          const after = toCents(applyDiscount(base / 100, cfg.discountType, cfg.discountValue));
          line.couponCents = Math.max(0, base - after);
        }
        couponInfo = { code, name: found.name, amount: euros(lines.reduce((s2, l) => s2 + l.couponCents, 0)) };
      }
    }
  }

  let originalTotal = 0;
  let finalTotal = 0;
  const outLines = lines.map((l) => {
    const final = Math.max(0, l.unitCents - l.offerCents - l.couponCents);
    originalTotal += l.originalCents;
    finalTotal += final;
    return {
      productId: l.productId,
      name: l.name,
      image: l.image,
      originalPrice: euros(l.originalCents),
      productDiscount: euros(l.originalCents - l.unitCents),
      offerDiscount: euros(l.offerCents),
      offerName: l.offerName,
      couponDiscount: euros(l.couponCents),
      finalPrice: euros(final)
    };
  });

  return {
    lines: outLines,
    subtotal: euros(originalTotal),
    discount: euros(originalTotal - finalTotal),
    total: euros(finalTotal),
    totalCents: finalTotal,
    offers: [...appliedOffers.keys()],
    coupon: couponInfo,
    couponError,
    couponBlocked,
    owned: ownedNames
  };
}

// ---------- Display helpers ----------
export function paymentLabel(gateway, apm) {
  const g = String(gateway || '').toUpperCase();
  const a = String(apm || '').toUpperCase();
  if (g === 'FREE') return 'Free order';
  if (a === 'CARD') return g ? `Card (${g.charAt(0) + g.slice(1).toLowerCase()})` : 'Card';
  if (g || a) return g || a;
  return '';
}

export function formatOrderNumber(n) {
  return n == null ? '' : 'EV-' + String(n).padStart(6, '0');
}

// Everything about a sale, for the admin area. Secrets are never included.
export function shapeSale(p, buyer) {
  return {
    id: p.id,
    orderCode: p.order_code || '',
    orderNumber: formatOrderNumber(p.order_number),
    status: p.status,
    amount: Number(p.amount_eur) || 0,
    subtotal: Number(p.subtotal_eur) || 0,
    discountAmount: Number(p.discount_amount) || 0,
    discountCode: p.discount_code || '',
    offers: Array.isArray(p.offers) ? p.offers : [],
    pointsUsed: Number(p.points_used) || 0,
    currency: p.currency || 'EUR',
    paymentMethod: p.payment_method || '',
    paymentGateway: p.payment_gateway || '',
    paymentApm: p.payment_apm || '',
    provider: p.provider || '',
    providerInvoiceId: p.provider_invoice_id || '',
    customerEmail: p.customer_email || '',
    buyerDiscord: p.buyer_discord || '',
    buyerIp: p.buyer_ip || '',
    deliveryStatus: p.delivery_status || 'none',
    failureReason: p.failure_reason || '',
    failureCode: p.failure_code || null,
    failureText: p.failure_code ? errorText(p.failure_code) : '',
    expiresAt: p.expires_at || null,
    termsAcceptedAt: p.terms_accepted_at || null,
    ipChanged: !!p.order_ip_changed,
    items: Array.isArray(p.items) ? p.items : [],
    notes: p.notes || '',
    events: Array.isArray(p.events) ? p.events : [],
    createdAt: p.created_at,
    paidAt: p.paid_at || null,
    buyer: buyer
      ? {
          id: buyer.id,
          discordUsername: buyer.discord_username,
          discordId: buyer.discord_id || '',
          robloxUsername: buyer.roblox_username || '',
          robloxId: buyer.roblox_id || '',
          email: buyer.email || ''
        }
      : null
  };
}

// ---------- Timeline + bot queue ----------
export async function pushEvent(purchaseId, text) {
  try {
    const { data } = await supabase.from('purchases').select('events').eq('id', purchaseId).maybeSingle();
    const events = Array.isArray(data && data.events) ? data.events : [];
    events.push({ at: new Date().toISOString(), text: String(text).slice(0, 300) });
    await supabase.from('purchases').update({ events: events.slice(-60) }).eq('id', purchaseId);
  } catch (err) {
    console.error('pushEvent failed:', err && err.message);
  }
}

export async function enqueueBotEvent(kind, purchaseId, payload) {
  const { error } = await supabase.from('bot_events').insert({ kind, purchase_id: purchaseId || null, payload: payload || {} });
  if (error) console.error('enqueueBotEvent failed:', error.message);
}

// Tells the bot to post a "suspicious activity" embed (same alert is not repeated for 2 minutes).
export async function securityAlert({ type, ip, user, email, details, key }) {
  try {
    const k = key || `${type}|${ip || ''}|${user ? user.id : ''}`;
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: dup } = await supabase.from('bot_events').select('id').eq('kind', 'security_alert').eq('payload->>key', k).gte('created_at', since).limit(1);
    if (dup && dup.length) return;
    await enqueueBotEvent('security_alert', null, {
      key: k, type, ip: ip || 'unknown', details: String(details || '').slice(0, 400),
      email: email || (user && user.email) || '', discord: user ? user.discord_username : '',
      roblox: user ? user.roblox_username || '' : '', discordId: user ? user.discord_id || '' : ''
    });
  } catch (err) {
    console.error('securityAlert failed:', err && err.message);
  }
}

// A license reached an account by gift / transfer: the bot sends the "License received" DM.
export async function queueLicenseReceived({ userId, productId, licenseId, productName, source, grantedBy }) {
  await enqueueBotEvent('license_received', null, { userId, productId, licenseId, productName, source, grantedBy: grantedBy || '' });
}

// Orders still "pending" whose page stopped answering (closed / refreshed) or that took too long.
export async function sweepPending() {
  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const staleIso = new Date(now - STALE_MS).toISOString();
    const expired = await supabase.from('purchases')
      .update({ status: 'unpaid', failure_code: 202, failure_reason: errorText(202) })
      .eq('status', 'pending').eq('provider', 'shoppex').lt('expires_at', nowIso).select('id');
    const abandoned = await supabase.from('purchases')
      .update({ status: 'unpaid', failure_code: 201, failure_reason: errorText(201) })
      .eq('status', 'pending').eq('provider', 'shoppex').lt('last_seen_at', staleIso).select('id');
    for (const r of expired.data || []) await pushEvent(r.id, 'Not completed — Error 202: ' + errorText(202));
    for (const r of abandoned.data || []) await pushEvent(r.id, 'Not completed — Error 201: ' + errorText(201));
  } catch (err) {
    console.error('sweepPending failed:', err && err.message);
  }
}

export const STATUS_LABELS = { pending: 'Pending', paid: 'Completed', unpaid: 'Not completed', error: 'Error', incomplete: 'Incomplete' };

// ---------- Shoppex ----------
export async function createShoppexPayment({ title, email, value, currency, webhook, returnUrl, cancelUrl }) {
  const key = process.env.SHOPPEX_API_KEY;
  if (!key) throw new Error('SHOPPEX_API_KEY is not set');
  const base = String(process.env.SHOPPEX_API_URL || 'https://api.shoppex.io').replace(/\/+$/, '');
  const payload = {
    title: String(title).slice(0, 128),
    email,
    value,
    currency,
    webhook,
    return_url: returnUrl,
    cancel_url: cancelUrl
  };
  if (process.env.SHOPPEX_GATEWAY) payload.gateway = process.env.SHOPPEX_GATEWAY;

  const res = await fetch(base + '/dev/v1/payments', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json || !json.data) {
    const err = new Error('Shoppex responded with HTTP ' + res.status);
    err.detail = JSON.stringify((json && json.error) || json || {}).slice(0, 600);
    throw err;
  }
  return json.data;
}

// Verifies X-Shoppex-Signature-V2 = "v1,t=<ts>,h=<hex>" over `${deliveryId}.${ts}.${rawBody}`.
export function verifyShoppexSignature(rawBody, headers, secret) {
  try {
    const signature = String(headers['x-shoppex-signature-v2'] || '');
    const deliveryId = String(headers['x-shoppex-delivery'] || headers['x-shoppex-delivery-id'] || '');
    const timestampHeader = String(headers['x-shoppex-timestamp'] || '');
    if (!signature || !deliveryId || !secret) return false;

    const segments = signature.split(',').map((s) => s.trim());
    const parts = {};
    for (const seg of segments) {
      const i = seg.indexOf('=');
      if (i > 0) parts[seg.slice(0, i)] = seg.slice(i + 1);
    }
    if (!segments.includes('v1') || parts.t !== timestampHeader) return false;
    const ts = Number(parts.t);
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
    if (!/^[0-9a-f]{64}$/i.test(parts.h || '')) return false;

    const expected = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${deliveryId}.${parts.t}.`), rawBody]))
      .digest();
    const given = Buffer.from(parts.h, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch (err) {
    return false;
  }
}

// ---------- Order completion (idempotent) ----------
export async function grantLicenses(purchase) {
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  for (const it of items) {
    if (!it.productId) continue;
    const { data: existing } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', purchase.user_id)
      .eq('product_id', it.productId)
      .limit(1);
    if (existing && existing.length) continue;
    const { error } = await supabase.from('licenses').insert({
      id: randomUUID(),
      user_id: purchase.user_id,
      product_id: it.productId,
      product_name: it.name,
      purchase_id: purchase.id,
      order_number: purchase.order_number,
      source: 'purchase'
    });
    if (error && error.code !== '23505') console.error('grantLicenses error:', error.message);
  }
}

// Marks an order paid exactly once, grants the licenses and queues the bot.
export async function markPaid(purchase, info) {
  const email = (info && EMAIL_RE.test(String(info.email || '')) ? String(info.email).trim() : '') || purchase.customer_email || null;
  const gateway = info && info.gateway ? String(info.gateway).slice(0, 40) : null;
  const apm = info && info.apm ? String(info.apm).slice(0, 40) : null;

  const { data: row, error } = await supabase
    .from('purchases')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      customer_email: email,
      payment_gateway: gateway,
      payment_apm: apm,
      payment_method: paymentLabel(gateway, apm) || null,
      failure_reason: null,
      failure_code: null,
      delivery_status: 'queued'
    })
    .eq('id', purchase.id)
    .neq('status', 'paid')
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!row) return { already: true };

  try {
    await grantLicenses(row);
    await pushEvent(row.id, 'Payment confirmed by Shoppex. Licenses granted.');
  } catch (err) {
    console.error('grantLicenses failed:', err && err.message);
    await supabase.from('purchases').update({ failure_code: 501, failure_reason: errorText(501) }).eq('id', row.id);
    await pushEvent(row.id, 'Payment confirmed but licenses failed — Error 501.');
  }
  await enqueueBotEvent('sale_complete', row.id);
  return { already: false, purchase: row };
}

export async function markFailed(purchase, code, opts = {}) {
  const status = opts.status || 'unpaid';
  const { data: row } = await supabase
    .from('purchases')
    .update({ status, failure_code: code, failure_reason: errorText(code) })
    .eq('id', purchase.id)
    .neq('status', 'paid')
    .or(`failure_code.is.null,failure_code.neq.${code}`)
    .select()
    .maybeSingle();
  if (!row) return false;
  await pushEvent(row.id, `${STATUS_LABELS[status] || status} — Error ${code}: ${errorText(code)}`);
  const notify = opts.notify === undefined ? code >= 300 : opts.notify;
  if (notify) await enqueueBotEvent('sale_failed', row.id);
  return true;
}
