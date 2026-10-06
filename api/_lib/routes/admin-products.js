// /api/admin/products...  (admin only)
import { randomUUID } from 'node:crypto';
import { supabase, MEDIA_BUCKET, FILES_BUCKET } from '../db.js';
import { queueLicenseReceived } from '../shop-core.js';
import { send, body, cleanText, UUID_RE } from '../http.js';
import { cleanHtml } from '../sanitize.js';
import { applyDiscount, applyDiscountRobux } from '../pricing.js';
import { findRecipient } from './admin-users.js';

const STATUSES = ['private', 'public', 'unlisted'];
const DISCOUNT_TYPES = ['none', 'percent', 'amount'];
const STORAGE_PATH_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;

function mediaUrl(path) {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function optionalInt(value) {
  if (value === '' || value === null || value === undefined) return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: true };
  return { value: Math.round(n) };
}

export async function normalizeProduct(b) {
  const name = cleanText(b.name, 120);
  if (!name) return { error: 'Product name is required.' };

  const price = Number(b.priceEur);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) return { error: 'Enter a valid price.' };
  const priceEur = Math.round(price * 100) / 100;

  const discountType = DISCOUNT_TYPES.includes(b.discountType) ? b.discountType : 'none';
  let discountValue = 0;
  if (discountType !== 'none') {
    discountValue = Number(b.discountValue);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return { error: 'Enter the discount amount, or choose "No discount".' };
    }
    if (discountType === 'percent' && discountValue > 100) return { error: 'A percentage discount cannot be more than 100%.' };
    if (discountType === 'amount' && discountValue > priceEur) return { error: 'The discount cannot be higher than the price.' };
    discountValue = Math.round(discountValue * 100) / 100;
  }

  const robux = optionalInt(b.priceRobux);
  if (robux.error) return { error: 'Enter a valid Robux price.' };
  const robuxDiscountType = DISCOUNT_TYPES.includes(b.discountRobuxType) ? b.discountRobuxType : 'none';
  let robuxDiscountValue = 0;
  if (robuxDiscountType !== 'none') {
    robuxDiscountValue = Number(b.discountRobuxValue);
    if (!Number.isFinite(robuxDiscountValue) || robuxDiscountValue <= 0) {
      return { error: 'Enter the Robux discount amount, or choose "No discount".' };
    }
    if (robuxDiscountType === 'percent' && robuxDiscountValue > 100) return { error: 'A Robux percentage discount cannot be more than 100%.' };
    if (robuxDiscountType === 'amount' && robux.value !== null && robuxDiscountValue > robux.value) {
      return { error: 'The Robux discount cannot be higher than the Robux price.' };
    }
  }

  const media = [];
  for (const item of (Array.isArray(b.media) ? b.media : []).slice(0, 20)) {
    if (!item || (item.type !== 'image' && item.type !== 'video')) continue;
    if (item.source === 'upload') {
      if (!STORAGE_PATH_RE.test(String(item.path || ''))) return { error: 'One of the uploaded images/videos is invalid.' };
      media.push({ type: item.type, source: 'upload', path: item.path, url: mediaUrl(item.path) });
    } else {
      const url = cleanText(item.url, 1000);
      if (!/^https?:\/\//i.test(url)) return { error: 'Image/video links must start with http:// or https://' };
      media.push({ type: item.type, source: 'link', url });
    }
  }

  const deliverables = [];
  for (const file of (Array.isArray(b.deliverables) ? b.deliverables : []).slice(0, 100)) {
    if (!file || !STORAGE_PATH_RE.test(String(file.path || ''))) return { error: 'One of the product files is invalid.' };
    deliverables.push({ name: cleanText(file.name, 200) || 'file', path: file.path, size: Number(file.size) || 0 });
  }

  const deliveryLink = cleanText(b.deliveryLink, 1000);
  if (deliveryLink && !/^https?:\/\//i.test(deliveryLink)) {
    return { error: 'The download link must start with http:// or https://' };
  }

  const status = STATUSES.includes(b.status) ? b.status : 'public';

  return {
    value: {
      name,
      media,
      description_html: await cleanHtml(b.descriptionHtml),
      category: cleanText(b.category, 60),
      extra_details: cleanText(b.extraDetails, 2000),
      price_eur: priceEur,
      discount_type: discountType,
      discount_value: discountValue,
      price_robux: robux.value,
      discount_robux_type: robuxDiscountType,
      discount_robux_value: robuxDiscountValue,
      deliverables,
      delivery_link: deliveryLink,
      label: cleanText(b.label, 30),
      status,
      instructions_html: await cleanHtml(b.instructionsHtml)
    }
  };
}

function firstImage(media) {
  const img = (Array.isArray(media) ? media : []).find((m) => m.type === 'image');
  return img ? img.url : '';
}

function shapeProduct(p, full) {
  const out = {
    id: p.id,
    name: p.name,
    status: p.status,
    category: p.category || '',
    label: p.label || '',
    priceEur: Number(p.price_eur) || 0,
    discountType: p.discount_type,
    discountValue: Number(p.discount_value) || 0,
    finalPrice: applyDiscount(p.price_eur, p.discount_type, p.discount_value),
    image: firstImage(p.media),
    publishedAt: p.published_at,
    updatedAt: p.updated_at
  };
  if (full) {
    Object.assign(out, {
      media: p.media || [],
      descriptionHtml: p.description_html || '',
      extraDetails: p.extra_details || '',
      priceRobux: p.price_robux,
      discountRobuxType: p.discount_robux_type,
      discountRobuxValue: Number(p.discount_robux_value) || 0,
      finalRobux: p.price_robux === null ? null : applyDiscountRobux(p.price_robux, p.discount_robux_type, p.discount_robux_value),
      deliverables: p.deliverables || [],
      deliveryLink: p.delivery_link || '',
      instructionsHtml: p.instructions_html || ''
    });
  }
  return out;
}

// Best-effort removal of storage objects that are no longer referenced.
async function removeFiles(bucket, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  try {
    await supabase.storage.from(bucket).remove(list);
  } catch (err) {
    console.error('Storage cleanup error:', err);
  }
}

function uploadedPaths(product) {
  return {
    media: (product.media || []).filter((m) => m.source === 'upload').map((m) => m.path),
    files: (product.deliverables || []).map((f) => f.path)
  };
}

async function listProducts(res) {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,status,category,label,price_eur,discount_type,discount_value,media,published_at,updated_at')
    .order('published_at', { ascending: false })
    .limit(1000);
  if (error) {
    console.error('List products error:', error);
    return send(res, 500, { error: 'Could not load products.' });
  }
  send(res, 200, { products: data.map((p) => shapeProduct(p, false)) });
}

async function getProduct(res, id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (error) return send(res, 500, { error: 'Could not load the product.' });
  if (!data) return send(res, 404, { error: 'Product not found.' });
  send(res, 200, { product: shapeProduct(data, true) });
}

async function createProduct(req, res) {
  const parsed = await normalizeProduct(body(req));
  if (parsed.error) return send(res, 400, { error: parsed.error });

  const { data, error } = await supabase
    .from('products')
    .insert({ ...parsed.value, published_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) {
    console.error('Create product error:', error);
    return send(res, 500, { error: 'Could not save the product.' });
  }
  send(res, 201, { id: data.id });
}

async function updateProduct(req, res, id) {
  const parsed = await normalizeProduct(body(req));
  if (parsed.error) return send(res, 400, { error: parsed.error });

  const { data: before, error: loadError } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (loadError) return send(res, 500, { error: 'Could not load the product.' });
  if (!before) return send(res, 404, { error: 'Product not found.' });

  const { error } = await supabase
    .from('products')
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('Update product error:', error);
    return send(res, 500, { error: 'Could not save the product.' });
  }

  // Delete files that were removed from the product.
  const oldPaths = uploadedPaths(before);
  const newPaths = uploadedPaths({ media: parsed.value.media, deliverables: parsed.value.deliverables });
  await removeFiles(MEDIA_BUCKET, oldPaths.media.filter((p) => !newPaths.media.includes(p)));
  await removeFiles(FILES_BUCKET, oldPaths.files.filter((p) => !newPaths.files.includes(p)));

  send(res, 200, { id });
}

async function deleteProduct(res, id) {
  const { data, error } = await supabase.from('products').delete().eq('id', id).select('*');
  if (error) {
    console.error('Delete product error:', error);
    return send(res, 500, { error: 'Could not delete the product.' });
  }
  if (!data || !data.length) return send(res, 404, { error: 'Product not found.' });

  const paths = uploadedPaths(data[0]);
  await removeFiles(MEDIA_BUCKET, paths.media);
  await removeFiles(FILES_BUCKET, paths.files);
  send(res, 200, { success: true });
}

async function republishProduct(res, id) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('products')
    .update({ status: 'public', published_at: now, updated_at: now })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return send(res, 500, { error: 'Could not republish the product.' });
  if (!data) return send(res, 404, { error: 'Product not found.' });
  send(res, 200, { success: true });
}

async function giveProduct(req, res, id, me) {
  const { data: product, error } = await supabase.from('products').select('id,name').eq('id', id).maybeSingle();
  if (error) return send(res, 500, { error: 'Could not load the product.' });
  if (!product) return send(res, 404, { error: 'Product not found.' });

  const found = await findRecipient(body(req).discordUsername, body(req).robloxUsername);
  if (found.error) return send(res, found.status || 400, { error: found.error });

  const { data: dup } = await supabase
    .from('licenses')
    .select('id')
    .eq('user_id', found.user.id)
    .eq('product_id', id)
    .limit(1);
  if (dup && dup.length) return send(res, 409, { error: 'That account already owns this product.' });

  const licenseId = randomUUID();
  const { error: insertError } = await supabase.from('licenses').insert({
    id: licenseId,
    user_id: found.user.id,
    product_id: id,
    product_name: product.name,
    source: 'gift',
    granted_by: me.discord_username
  });
  if (insertError) {
    console.error('Give product error:', insertError);
    return send(res, 500, { error: 'Could not give the product.', detail: insertError.message });
  }
  await queueLicenseReceived({ userId: found.user.id, productId: id, licenseId, productName: product.name, source: 'gift', grantedBy: me.discord_username });
  send(res, 200, { success: true, recipient: found.user.discord_username });
}

export async function handleProducts(req, res, parts, me) {
  const id = parts[1];
  const action = parts[2];

  if (!id) {
    if (req.method === 'GET') return listProducts(res);
    if (req.method === 'POST') return createProduct(req, res);
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (!UUID_RE.test(id)) return send(res, 400, { error: 'Invalid product id.' });

  if (!action) {
    if (req.method === 'GET') return getProduct(res, id);
    if (req.method === 'PUT' || req.method === 'PATCH') return updateProduct(req, res, id);
    if (req.method === 'DELETE') return deleteProduct(res, id);
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (action === 'republish' && req.method === 'POST') return republishProduct(res, id);
  if (action === 'give' && req.method === 'POST') return giveProduct(req, res, id, me);
  send(res, 404, { error: 'Not found' });
}
