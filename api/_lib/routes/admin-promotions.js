// /api/admin/promotions...  (admin only)
import { supabase } from '../db.js';
import { send, body, cleanText, UUID_RE } from '../http.js';

const TYPES = ['coupon', 'buy_get', 'first_purchase', 'min_spend'];

function idList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((x) => typeof x === 'string' && UUID_RE.test(x)))].slice(0, 200);
}

async function allProductsExist(ids) {
  if (!ids.length) return true;
  const { data, error } = await supabase.from('products').select('id').in('id', ids);
  return !error && (data || []).length === ids.length;
}

export async function normalizePromotion(b) {
  const name = cleanText(b.name, 100);
  if (!name) return { error: 'Enter a name for the promotion.' };

  const type = b.type;
  if (!TYPES.includes(type)) return { error: 'Choose a promotion option.' };

  const discountType = b.discountType === 'amount' ? 'amount' : 'percent';
  const discountValue = Number(b.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) return { error: 'Enter the discount amount.' };
  if (discountType === 'percent' && discountValue > 100) return { error: 'A percentage discount cannot be more than 100%.' };

  const config = { discountType, discountValue: Math.round(discountValue * 100) / 100 };

  if (type === 'coupon') {
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
      return { error: 'The coupon code must be 3-30 characters (letters, numbers, - or _).' };
    }
    config.code = code;
  }

  if (type === 'buy_get') {
    config.requiredProductIds = idList(b.requiredProductIds);
    if (!config.requiredProductIds.length) return { error: 'Select the product(s) the customer must buy.' };
  }

  if (type === 'min_spend') {
    const minAmount = Number(b.minAmount);
    if (!Number.isFinite(minAmount) || minAmount <= 0) return { error: 'Enter the minimum purchase amount.' };
    config.minAmount = Math.round(minAmount * 100) / 100;
  }

  if (type !== 'coupon') {
    config.targetProductIds = idList(b.targetProductIds);
    if (!config.targetProductIds.length) return { error: 'Select the product(s) that will get the discount.' };
  }

  const referenced = [...(config.requiredProductIds || []), ...(config.targetProductIds || [])];
  if (!(await allProductsExist([...new Set(referenced)]))) {
    return { error: 'One of the selected products no longer exists. Reload the page and try again.' };
  }

  let endsAt = null;
  if (b.endsAt) {
    const d = new Date(b.endsAt);
    if (Number.isNaN(d.getTime())) return { error: 'The end date is not valid.' };
    if (d.getTime() <= Date.now()) return { error: 'The end date must be in the future.' };
    endsAt = d.toISOString();
  }

  return { value: { name, type, config, active: b.active !== false, ends_at: endsAt } };
}

function shape(p) {
  return { id: p.id, name: p.name, type: p.type, active: !!p.active, config: p.config || {}, createdAt: p.created_at, endsAt: p.ends_at || null };
}

async function couponClash(code, exceptId) {
  let query = supabase.from('promotions').select('id').eq('type', 'coupon').eq('config->>code', code).limit(1);
  if (exceptId) query = query.neq('id', exceptId);
  const { data } = await query;
  return !!(data && data.length);
}

export async function handlePromotions(req, res, parts) {
  const id = parts[1];

  if (!id) {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('promotions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return send(res, 500, { error: 'Could not load promotions.' });
      return send(res, 200, { promotions: data.map(shape) });
    }

    if (req.method === 'POST') {
      const parsed = await normalizePromotion(body(req));
      if (parsed.error) return send(res, 400, { error: parsed.error });
      if (parsed.value.type === 'coupon' && (await couponClash(parsed.value.config.code))) {
        return send(res, 409, { error: 'A coupon with that code already exists.' });
      }
      const { data, error } = await supabase.from('promotions').insert(parsed.value).select().single();
      if (error) {
        console.error('Create promotion error:', error);
        return send(res, 500, { error: 'Could not create the promotion.' });
      }
      return send(res, 201, { promotion: shape(data) });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (!UUID_RE.test(id)) return send(res, 400, { error: 'Invalid promotion id.' });

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = await normalizePromotion(body(req));
    if (parsed.error) return send(res, 400, { error: parsed.error });
    if (parsed.value.type === 'coupon' && (await couponClash(parsed.value.config.code, id))) {
      return send(res, 409, { error: 'A coupon with that code already exists.' });
    }
    const { data, error } = await supabase.from('promotions').update(parsed.value).eq('id', id).select().maybeSingle();
    if (error) return send(res, 500, { error: 'Could not save the promotion.' });
    if (!data) return send(res, 404, { error: 'Promotion not found.' });
    return send(res, 200, { promotion: shape(data) });
  }

  if (req.method === 'DELETE') {
    const { data, error } = await supabase.from('promotions').delete().eq('id', id).select('id');
    if (error) return send(res, 500, { error: 'Could not delete the promotion.' });
    if (!data || !data.length) return send(res, 404, { error: 'Promotion not found.' });
    return send(res, 200, { success: true });
  }

  send(res, 405, { error: 'Method not allowed' });
}
