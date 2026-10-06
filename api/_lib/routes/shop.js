// /api/shop/*  — storefront checkout, Shoppex webhook, licenses and secure downloads.
//   GET  cart?ids=          public     product cards for the cart drawer
//   POST quote              public     totals for the order summary
//   POST checkout           login      creates the order + Shoppex payment
//   GET  order?o=CODE       owner      status of one order (polled while paying)
//   GET  licenses           login      the user's licenses
//   POST download/token     login      5-minute download link for one license
//   POST download/redeem    login      checks the link and returns short-lived file URLs
//   POST webhook?o=CODE     Shoppex    signed payment events (per-order secret)
import { createHash } from 'node:crypto';
import { supabase, FILES_BUCKET } from '../db.js';
import { getSessionUser } from '../auth.js';
import { send, UUID_RE } from '../http.js';
import { clientIp, sameOrigin, hit, tooMany } from '../guard.js';
import { applyDiscount, discountBadge } from '../pricing.js';
import {
  EMAIL_RE, MAX_CART, DOWNLOAD_TTL_MS, ORDER_TTL_MS, buildQuote, newOrderCode, isOrderCode, newToken, hashToken,
  siteUrl, createShoppexPayment, verifyShoppexSignature, markPaid, markFailed, pushEvent, enqueueBotEvent,
  securityAlert, sweepPending, formatOrderNumber
} from '../shop-core.js';
import { errorText } from '../error-codes.js';

const MINUTE = 60 * 1000;

// ---------- small helpers ----------
async function readRaw(req, limit = 200000) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    const raw = await readRaw(req);
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch (err) {
    return {};
  }
}

function shopHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// Browser-initiated writes must come from our own pages.
function guardWrite(req, res) {
  if (!sameOrigin(req) || req.headers['x-requested-with'] !== 'elvira-shop') {
    send(res, 403, { error: 'Forbidden' });
    return false;
  }
  return true;
}

// Logged in, not blocked and Roblox-verified.
async function requireCustomer(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    send(res, 401, { error: 'Please log in to continue.', code: 'login_required' });
    return null;
  }
  if (user.blocked) {
    send(res, 403, { error: 'Your account is blocked.', code: 'blocked' });
    return null;
  }
  if (!user.roblox_id) {
    send(res, 403, { error: 'Please finish verifying your Roblox account first.', code: 'verify_required' });
    return null;
  }
  return user;
}

function idsFrom(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((s) => String(s).trim()))].filter((s) => UUID_RE.test(s)).slice(0, MAX_CART);
}

function publicQuote(q) {
  return {
    items: q.lines,
    subtotal: q.subtotal,
    discount: q.discount,
    total: q.total,
    offers: q.offers,
    coupon: q.coupon,
    couponError: q.couponError,
    owned: q.owned
  };
}

// ---------- GET cart ----------
async function cartInfo(req, res, query) {
  const ids = idsFrom(query.ids);
  if (!ids.length) return send(res, 200, { items: [] });
  const { data, error } = await supabase
    .from('products')
    .select('id,name,media,price_eur,discount_type,discount_value')
    .in('id', ids)
    .in('status', ['public', 'unlisted']);
  if (error) return send(res, 500, { error: 'Could not load the cart.' });
  const items = ids
    .map((id) => (data || []).find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => {
      const media = Array.isArray(p.media) ? p.media : [];
      const image = media.find((m) => m.type === 'image');
      const original = Number(p.price_eur) || 0;
      const final = applyDiscount(original, p.discount_type, p.discount_value);
      return {
        id: p.id,
        name: p.name,
        image: image ? image.url : '',
        original,
        final,
        badge: final < original ? discountBadge(p.discount_type, p.discount_value, original, final) : ''
      };
    });
  send(res, 200, { items });
}

// ---------- POST quote ----------
async function quote(req, res) {
  const b = await readJson(req);
  const user = await getSessionUser(req);
  const q = await buildQuote({ ids: idsFrom(b.ids), user: user && !user.blocked ? user : null, coupon: b.coupon, ip: clientIp(req) });
  if (q.error) return send(res, q.status || 400, { error: q.error });
  send(res, 200, { ...publicQuote(q), loggedIn: !!user, email: user ? user.email || '' : '' });
}

// ---------- POST checkout ----------
// Creates the order ONLY when the buyer presses "Continue" (so refreshing never piles up pending sales).
async function checkout(req, res) {
  const user = await requireCustomer(req, res);
  if (!user) return;
  const ip = clientIp(req);
  if (hit('checkout:' + user.id, 12, 10 * MINUTE)) return tooMany(res);

  const b = await readJson(req);
  if (b.acceptTerms !== true) {
    return send(res, 400, { error: 'Please accept the purchase terms and the product policy to continue.', code: 'terms_required' });
  }
  const ids = idsFrom(b.ids);
  const q = await buildQuote({ ids, user, coupon: b.coupon, ip });
  if (q.error) return send(res, q.status || 400, { error: q.error });
  if (q.owned.length) return send(res, 409, { error: 'You already own: ' + q.owned.join(', ') + '. Remove it to continue.', code: 'owned' });
  if (b.coupon && q.couponError) {
    if (q.couponBlocked) {
      await securityAlert({
        type: 'Coupon already redeemed from this IP', ip, user, email: b.email,
        details: `Coupon ${String(b.coupon).trim().toUpperCase()} was used again from an IP that already redeemed it (Error 602).`,
        key: `coupon|${ip}|${user.id}`
      });
    }
    return send(res, q.couponBlocked ? 409 : 400, { error: q.couponError, code: q.couponBlocked ? 'coupon_reused' : 'coupon' });
  }

  const email = String(b.email || user.email || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return send(res, 400, { error: 'Please enter a valid email address for your receipt.', code: 'email_required' });
  }

  await sweepPending();

  // Flood protection: too many orders in a short time is suspicious.
  const since = new Date(Date.now() - 10 * MINUTE).toISOString();
  const byUser = await supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
  const byIp = await supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('buyer_ip', ip).gte('created_at', since);
  if ((byUser.count || 0) >= 8 || (byIp.count || 0) >= 12) {
    await securityAlert({ type: 'Too many orders in a short time', ip, user, email, details: 'More than 8 orders in 10 minutes (Error 601).', key: `flood|${ip}|${user.id}` });
    return send(res, 429, { error: 'Too many orders in a short time. Please wait a few minutes and try again.', code: 'flood' });
  }

  const fingerprint = createHash('sha256')
    .update([...ids].sort().join(',') + '|' + (q.coupon ? q.coupon.code : '') + '|' + q.totalCents + '|' + email.toLowerCase())
    .digest('hex');

  // A double click must not create two payments: reuse the one that is still open and being watched.
  if (q.totalCents > 0) {
    const fresh = new Date(Date.now() - 20 * 1000).toISOString();
    const { data: open } = await supabase.from('purchases').select('id,order_code').eq('user_id', user.id).eq('status', 'pending').gte('last_seen_at', fresh).limit(10);
    if (open && open.length) {
      const { data: secrets } = await supabase.from('order_secrets').select('purchase_id,pay_url').in('purchase_id', open.map((o) => o.id)).eq('fingerprint', fingerprint).limit(1);
      if (secrets && secrets.length && secrets[0].pay_url) {
        const match = open.find((o) => o.id === secrets[0].purchase_id);
        await supabase.from('purchases').update({ last_seen_at: new Date().toISOString() }).eq('id', match.id);
        return send(res, 200, { orderCode: match.order_code, payUrl: secrets[0].pay_url, total: q.total, reused: true });
      }
    }
  }

  const items = q.lines.map((l) => ({
    productId: l.productId, name: l.name, image: l.image, originalPrice: l.originalPrice, productDiscount: l.productDiscount,
    offerDiscount: l.offerDiscount, offerName: l.offerName, couponDiscount: l.couponDiscount, finalPrice: l.finalPrice
  }));

  const nowIso = new Date().toISOString();
  let purchase = null;
  for (let attempt = 0; attempt < 5 && !purchase; attempt++) {
    const { data, error } = await supabase
      .from('purchases')
      .insert({
        user_id: user.id, buyer_discord: user.discord_username, status: 'pending', amount_eur: q.total, subtotal_eur: q.subtotal,
        currency: 'EUR', discount_code: q.coupon ? q.coupon.code : null, discount_amount: q.discount, offers: q.offers, items,
        customer_email: email, buyer_ip: ip, order_code: newOrderCode(), provider: q.totalCents > 0 ? 'shoppex' : 'free',
        last_seen_at: nowIso, expires_at: new Date(Date.now() + ORDER_TTL_MS).toISOString(), terms_accepted_at: nowIso,
        events: [{ at: nowIso, text: 'Order created. Purchase terms and product policy accepted.' }]
      })
      .select()
      .single();
    if (!error) purchase = data;
    else if (error.code !== '23505') {
      console.error('Create purchase error:', error);
      return send(res, 500, { error: 'Could not create your order. Please try again.', detail: error.message });
    }
  }
  if (!purchase) return send(res, 500, { error: 'Could not create your order. Please try again.' });

  if (q.totalCents === 0) {
    await markPaid(purchase, { email, gateway: 'FREE' });
    return send(res, 200, { orderCode: purchase.order_code, free: true, total: 0 });
  }

  const base = siteUrl(req);
  try {
    const pay = await createShoppexPayment({
      title: 'Elvira order ' + purchase.order_code, email, value: q.total,
      currency: String(process.env.SHOPPEX_CURRENCY || 'EUR').toUpperCase(),
      webhook: `${base}/api/shop/webhook?o=${encodeURIComponent(purchase.order_code)}`,
      returnUrl: `${base}/ordercompleted.html?o=${encodeURIComponent(purchase.order_code)}`,
      cancelUrl: `${base}/ordererror.html?o=${encodeURIComponent(purchase.order_code)}&c=cancelled`
    });
    const invoiceId = String(pay.uniqid || pay.id || '');
    const url = String(pay.url || pay.checkout_url || '');
    if (!pay.webhook_secret || !invoiceId || !/^https:\/\//i.test(url)) {
      throw Object.assign(new Error('Shoppex response is missing webhook_secret / uniqid / url'), { incomplete: true });
    }
    const { error: secretError } = await supabase.from('order_secrets').insert({
      purchase_id: purchase.id, webhook_secret: pay.webhook_secret, provider_invoice_id: invoiceId, pay_url: url, fingerprint
    });
    if (secretError) throw secretError;
    await supabase.from('purchases').update({ provider_invoice_id: invoiceId }).eq('id', purchase.id);
    await pushEvent(purchase.id, 'Shoppex payment created (' + invoiceId + ').');
    await enqueueBotEvent('sale_started', purchase.id);
    return send(res, 200, { orderCode: purchase.order_code, payUrl: url, total: q.total });
  } catch (err) {
    console.error('Shoppex create payment failed:', err && err.message, err && err.detail);
    await pushEvent(purchase.id, ('Shoppex error: ' + (err && err.message) + (err && err.detail ? ' — ' + err.detail : '')).slice(0, 290));
    await markFailed(purchase, err && err.incomplete ? 102 : 101, { status: 'error' });
    return send(res, 502, { error: 'The payment provider is not available right now. Please try again in a moment.', code: 'provider' });
  }
}

// ---------- GET order (also the "I am still here" heartbeat of the order page) ----------
async function orderStatus(req, res, query) {
  const user = await getSessionUser(req);
  if (!user) return send(res, 401, { error: 'Please log in.', code: 'login_required' });
  const code = String(query.o || '').toUpperCase();
  if (!isOrderCode(code)) return send(res, 404, { error: 'Order not found.' });
  await sweepPending();
  let { data: p } = await supabase.from('purchases').select('*').eq('order_code', code).eq('user_id', user.id).maybeSingle();
  if (!p) return send(res, 404, { error: 'Order not found.' });

  let restart = false;
  if (p.status === 'pending') {
    const ip = clientIp(req);
    if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) {
      await markFailed(p, 202);
      restart = true;
      p = { ...p, status: 'unpaid', failure_code: 202 };
    } else {
      const patch = { last_seen_at: new Date().toISOString() };
      if (p.buyer_ip && ip !== 'unknown' && p.buyer_ip !== ip) {
        restart = true; // the order is being watched from another network: start again to be safe
        if (!p.order_ip_changed) {
          patch.order_ip_changed = true;
          await securityAlert({ type: 'Order opened from a different IP', ip, user, details: `Order #${p.order_code} was created from ${p.buyer_ip} and is now open from ${ip}.`, key: `ipchg|${p.order_code}` });
        }
      }
      await supabase.from('purchases').update(patch).eq('id', p.id);
    }
  }
  // The order timed out: the buyer starts again from the order page.
  if (p.status === 'unpaid' && p.failure_code === 202) restart = true;
  send(res, 200, {
    orderCode: p.order_code, status: p.status, restart, failureCode: p.failure_code || null,
    failureText: p.failure_code ? errorText(p.failure_code) : '',
    total: Number(p.amount_eur) || 0, subtotal: Number(p.subtotal_eur) || 0, discount: Number(p.discount_amount) || 0,
    items: (Array.isArray(p.items) ? p.items : []).map((i) => ({ name: i.name, image: i.image, finalPrice: i.finalPrice })),
    createdAt: p.created_at
  });
}

// ---------- POST order/cancel (the buyer pressed "cancel" on the Shoppex page) ----------
async function cancelOrder(req, res) {
  const user = await requireCustomer(req, res);
  if (!user) return;
  const b = await readJson(req);
  const code = String(b.o || '').toUpperCase();
  if (!isOrderCode(code)) return send(res, 404, { error: 'Order not found.' });
  const { data: p } = await supabase.from('purchases').select('*').eq('order_code', code).eq('user_id', user.id).maybeSingle();
  if (!p) return send(res, 404, { error: 'Order not found.' });
  if (p.status === 'pending') await markFailed(p, 301);
  send(res, 200, { ok: true });
}

// ---------- POST leave (sendBeacon when the order page is closed / refreshed) ----------
async function leaveOrder(req, res, query) {
  const user = await getSessionUser(req);
  const code = String(query.o || '').toUpperCase();
  if (user && isOrderCode(code)) {
    const { data: p } = await supabase.from('purchases').select('*').eq('order_code', code).eq('user_id', user.id).eq('status', 'pending').maybeSingle();
    if (p) await markFailed(p, 201);
  }
  res.status(204).end();
}

// ---------- GET licenses ----------
async function licenses(req, res) {
  const user = await requireCustomer(req, res);
  if (!user) return;
  const { data: lic, error } = await supabase
    .from('licenses')
    .select('id,product_id,product_name,order_number,source,acquired_at,purchase_id')
    .eq('user_id', user.id)
    .order('acquired_at', { ascending: false })
    .limit(500);
  if (error) return send(res, 500, { error: 'Could not load your licenses.' });

  const productIds = [...new Set((lic || []).map((l) => l.product_id).filter(Boolean))];
  const purchaseIds = [...new Set((lic || []).map((l) => l.purchase_id).filter(Boolean))];
  const [prods, orders] = await Promise.all([
    productIds.length ? supabase.from('products').select('id,media,deliverables,delivery_link').in('id', productIds) : { data: [] },
    purchaseIds.length ? supabase.from('purchases').select('id,order_code').in('id', purchaseIds) : { data: [] }
  ]);
  const pMap = new Map((prods.data || []).map((p) => [p.id, p]));
  const oMap = new Map((orders.data || []).map((o) => [o.id, o.order_code]));

  send(res, 200, {
    licenses: (lic || []).map((l) => {
      const p = pMap.get(l.product_id);
      const media = p && Array.isArray(p.media) ? p.media : [];
      const image = media.find((m) => m.type === 'image');
      return {
        id: l.id,
        productId: l.product_id,
        name: l.product_name,
        image: image ? image.url : '',
        acquiredAt: l.acquired_at,
        source: l.source,
        orderCode: oMap.get(l.purchase_id) || formatOrderNumber(l.order_number) || '',
        downloadable: !!(p && ((Array.isArray(p.deliverables) && p.deliverables.length) || p.delivery_link))
      };
    })
  });
}

// ---------- POST download/token ----------
async function downloadToken(req, res) {
  const user = await requireCustomer(req, res);
  if (!user) return;
  if (hit('dltoken:' + user.id, 30, 10 * MINUTE)) return tooMany(res);
  const b = await readJson(req);
  const licenseId = String(b.licenseId || '');
  if (!UUID_RE.test(licenseId)) return send(res, 400, { error: 'Invalid license.' });

  const { data: lic } = await supabase
    .from('licenses')
    .select('id,product_id')
    .eq('id', licenseId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!lic || !lic.product_id) return send(res, 404, { error: 'License not found.' });

  const token = newToken();
  const { error } = await supabase.from('download_tokens').insert({
    token_hash: hashToken(token),
    user_id: user.id,
    product_id: lic.product_id,
    license_id: lic.id,
    expires_at: new Date(Date.now() + DOWNLOAD_TTL_MS).toISOString(),
    created_by: 'web'
  });
  if (error) {
    console.error('download token error:', error.message);
    return send(res, 500, { error: 'Could not create the download link.' });
  }
  send(res, 200, { url: '/download.html?t=' + token });
}

// ---------- POST download/redeem ----------
async function downloadRedeem(req, res) {
  const ip = clientIp(req);
  if (hit('dlredeem:' + ip, 40, 10 * MINUTE)) {
    await securityAlert({ type: 'Download rate limit exceeded', ip, details: 'More than 40 download link checks in 10 minutes.', key: `dlrate|${ip}` });
    return tooMany(res);
  }

  const user = await getSessionUser(req);
  if (!user) return send(res, 401, { error: 'Please log in with Discord.', code: 'login_required' });
  if (user.blocked) return send(res, 403, { error: 'Your account is blocked.', code: 'blocked' });

  const b = await readJson(req);
  const token = String(b.token || '');
  if (token.length < 20 || token.length > 100) return send(res, 404, { error: 'This download link is not valid.', code: 'invalid' });

  const { data: row } = await supabase.from('download_tokens').select('*').eq('token_hash', hashToken(token)).maybeSingle();
  if (!row) {
    if (hit('dlbad:' + ip, 8, 10 * MINUTE)) {
      await securityAlert({ type: 'Invalid download links tried repeatedly', ip, user, details: 'More than 8 unknown download links in 10 minutes.', key: `dlbad|${ip}|${user.id}` });
    }
    return send(res, 404, { error: 'This download link is not valid.', code: 'invalid' });
  }

  if (row.user_id !== user.id) {
    console.warn('[download-denied] wrong account', user.id, 'token owner', row.user_id, ip);
    await securityAlert({ type: 'Download link used by a different account', ip, user, details: `The link belongs to another account (product ${row.product_id}).`, key: `dlwrong|${ip}|${user.id}` });
    return send(res, 403, { error: 'This download belongs to a different account.', code: 'wrong_account' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) return send(res, 410, { error: 'The download link has expired.', code: 'expired' });
  if (row.used_count >= 10) return send(res, 429, { error: 'Too many download attempts for this link.', code: 'limit' });

  const { data: lic } = await supabase.from('licenses').select('id').eq('user_id', user.id).eq('product_id', row.product_id).limit(1);
  if (!lic || !lic.length) return send(res, 403, { error: 'You no longer own this product.', code: 'revoked' });

  const { data: product } = await supabase.from('products').select('name,deliverables,delivery_link').eq('id', row.product_id).maybeSingle();
  if (!product) return send(res, 404, { error: 'This product no longer exists.', code: 'invalid' });

  const files = [];
  let storageProblem = false;
  for (const f of Array.isArray(product.deliverables) ? product.deliverables : []) {
    const name = String(f.name || 'file').replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file';
    const { data: signed, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(f.path, 120, { download: name });
    if (error || !signed || !signed.signedUrl) {
      console.error('signed url error:', f.path, error && error.message);
      storageProblem = true;
      continue;
    }
    files.push({ name, size: Number(f.size) || 0, url: signed.signedUrl });
  }
  const link = /^https?:\/\//i.test(String(product.delivery_link || '')) ? product.delivery_link : '';
  if (!files.length && !link) {
    if (storageProblem) return send(res, 502, { error: 'The file could not be prepared right now. Please try again in a minute or contact support.', code: 'storage' });
    return send(res, 404, { error: 'This product does not have any files yet. Please contact support.', code: 'empty' });
  }

  await supabase.from('download_tokens').update({ used_count: row.used_count + 1, last_ip: ip }).eq('token_hash', row.token_hash);
  console.log('[download]', user.id, row.product_id, ip);
  await enqueueBotEvent('download_log', null, {
    userId: user.id, productId: row.product_id, productName: product.name, ip, discord: user.discord_username,
    roblox: user.roblox_username || '', email: user.email || ''
  });
  send(res, 200, { productName: product.name, files, link });
}

// ---------- POST webhook ----------
async function webhook(req, res, query) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const ip = clientIp(req);
  if (hit('wh:' + ip, 120, MINUTE)) return tooMany(res);

  let raw;
  try {
    raw = await readRaw(req);
  } catch (err) {
    return send(res, 413, { error: 'Body too large' });
  }

  const code = String(query.o || '').toUpperCase();
  if (!isOrderCode(code)) return send(res, 400, { error: 'Bad request' });

  const { data: purchase } = await supabase.from('purchases').select('*').eq('order_code', code).maybeSingle();
  const { data: secret } = purchase
    ? await supabase.from('order_secrets').select('webhook_secret,provider_invoice_id').eq('purchase_id', purchase.id).maybeSingle()
    : { data: null };
  if (!purchase || !secret) return send(res, 404, { error: 'Unknown order' });

  if (!verifyShoppexSignature(raw, req.headers, secret.webhook_secret)) {
    console.warn('[webhook] invalid signature for', code, ip);
    await securityAlert({ type: 'Invalid payment webhook signature', ip, details: `Someone sent a forged payment confirmation for order #${code}. It was rejected.`, key: `whsig|${code}|${ip}` });
    return send(res, 401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return send(res, 400, { error: 'Bad JSON' });
  }
  const event = String(payload.event || '');
  const data = payload.data || {};
  if (secret.provider_invoice_id && data.uniqid && String(data.uniqid) !== secret.provider_invoice_id) {
    console.warn('[webhook] invoice mismatch for', code);
    await markFailed(purchase, 403, { status: 'error' });
    return send(res, 400, { error: 'Invoice mismatch' });
  }

  const deliveryId = String(req.headers['x-shoppex-delivery'] || req.headers['x-shoppex-delivery-id'] || '');
  const { error: dupError } = await supabase.from('processed_webhooks').insert({ delivery_id: deliveryId, purchase_id: purchase.id, event });
  if (dupError && dupError.code === '23505') return send(res, 200, { ok: true, duplicate: true });

  if (event === 'order:paid' || event === 'order:paid:product') {
    const total = Number(data.total);
    const currency = String(data.currency || '').toUpperCase();
    const expectedCurrency = String(process.env.SHOPPEX_CURRENCY || 'EUR').toUpperCase();
    const amountOk = !Number.isFinite(total) || Math.abs(total - Number(purchase.amount_eur)) <= 0.01;
    const currencyOk = !currency || currency === expectedCurrency;
    if (!amountOk || !currencyOk) {
      console.error('[webhook] amount/currency mismatch', code, total, currency);
      await markFailed(purchase, amountOk ? 402 : 401, { status: 'error' });
      await securityAlert({ type: 'Paid amount did not match the order', ip, details: `Order #${code}: expected ${purchase.amount_eur} ${expectedCurrency}, received ${data.total} ${data.currency}.`, key: `whamt|${code}` });
      return send(res, 200, { ok: true, rejected: true });
    }
    await markPaid(purchase, { email: data.customer_email, gateway: data.gateway, apm: data.apm_method });
  } else if (/cancel|expire/i.test(event)) {
    await markFailed(purchase, 302);
  } else if (/fail|declin|reject/i.test(event)) {
    await markFailed(purchase, 303, { status: 'error' });
  }
  send(res, 200, { ok: true });
}

// ---------- router ----------
export async function handleShop(req, res, parts, query) {
  shopHeaders(res);
  const route = parts.join('/');
  const method = String(req.method || 'GET').toUpperCase();

  if (route === 'webhook') return webhook(req, res, query);

  if (method === 'GET') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Forbidden' });
    if (hit('shopget:' + clientIp(req), 400, MINUTE)) return tooMany(res);
    if (route === 'cart') return cartInfo(req, res, query);
    if (route === 'order') return orderStatus(req, res, query);
    if (route === 'licenses') return licenses(req, res);
    return send(res, 404, { error: 'Not found' });
  }

  if (method === 'POST') {
    // sendBeacon cannot add custom headers: it is accepted from our own pages only.
    if (route === 'leave') {
      if (!sameOrigin(req) || hit('leave:' + clientIp(req), 60, MINUTE)) return send(res, 403, { error: 'Forbidden' });
      return leaveOrder(req, res, query);
    }
    if (!guardWrite(req, res)) return;
    if (hit('shoppost:' + clientIp(req), 90, MINUTE)) return tooMany(res);
    if (route === 'quote') return quote(req, res);
    if (route === 'checkout') return checkout(req, res);
    if (route === 'order/cancel') return cancelOrder(req, res);
    if (route === 'download/token') return downloadToken(req, res);
    if (route === 'download/redeem') return downloadRedeem(req, res);
    return send(res, 404, { error: 'Not found' });
  }

  send(res, 405, { error: 'Method not allowed' });
}
