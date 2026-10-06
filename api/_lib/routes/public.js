// Public storefront endpoints (no login needed).
//   GET /api/public/products     -> products visible in the store
//   GET /api/public/product?id=  -> one product page
//   GET /api/public/site-config  -> status bar + information window
import { supabase } from '../db.js';
import { getSessionUser, effectiveRole } from '../auth.js';
import { send, UUID_RE } from '../http.js';
import { htmlToText } from '../sanitize.js';
import { applyDiscount, discountBadge } from '../pricing.js';
import { loadConfig } from './site-config.js';

function priceBlock(p) {
  const original = Number(p.price_eur) || 0;
  const final = applyDiscount(original, p.discount_type, p.discount_value);
  const hasDiscount = p.discount_type !== 'none' && final < original;
  return {
    original,
    final,
    hasDiscount,
    badge: hasDiscount ? discountBadge(p.discount_type, p.discount_value, original, final) : ''
  };
}

// Robux prices, the delivered files and the purchase instructions are never sent here.
async function card(p) {
  const media = Array.isArray(p.media) ? p.media : [];
  const image = media.find((m) => m.type === 'image');
  return {
    id: p.id,
    name: p.name,
    category: p.category || '',
    label: p.label || '',
    image: image ? image.url : '',
    summary: await htmlToText(p.description_html, 300),
    price: priceBlock(p)
  };
}

async function list(res) {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,label,media,description_html,price_eur,discount_type,discount_value,published_at')
    .eq('status', 'public')
    .order('published_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('Public products error:', error);
    return send(res, 500, { error: 'Could not load the products.' });
  }
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  send(res, 200, { products: await Promise.all(data.map(card)) });
}

async function one(req, res, query) {
  const id = String(query.id || '');
  if (!UUID_RE.test(id)) return send(res, 404, { error: 'Product not found.' });

  const { data: p, error } = await supabase
    .from('products')
    .select('id,name,category,label,media,description_html,extra_details,price_eur,discount_type,discount_value,status')
    .eq('id', id)
    .maybeSingle();
  if (error) return send(res, 500, { error: 'Could not load the product.' });
  if (!p) return send(res, 404, { error: 'Product not found.' });

  if (p.status === 'private') {
    const user = await getSessionUser(req);
    const role = effectiveRole(user);
    if (!user || user.blocked || (role !== 'admin' && role !== 'staff')) {
      return send(res, 404, { error: 'Product not found.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  }

  send(res, 200, {
    product: {
      ...(await card(p)),
      media: (Array.isArray(p.media) ? p.media : []).map((m) => ({ type: m.type, url: m.url })),
      descriptionHtml: p.description_html || '',
      extraDetails: p.extra_details || '',
      isPrivatePreview: p.status === 'private',
      isUnlisted: p.status === 'unlisted'
    }
  });
}

async function siteConfig(res) {
  const config = await loadConfig();
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
  send(res, 200, {
    statusBar: config.statusBar.active ? config.statusBar : null,
    infoWindow: config.infoWindow.active ? config.infoWindow : null,
    version: config.updatedAt
  });
}

export async function handlePublic(req, res, parts, query) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const route = parts.join('/');
  if (route === 'products') return list(res);
  if (route === 'product') return one(req, res, query);
  if (route === 'site-config') return siteConfig(res);
  send(res, 404, { error: 'Not found' });
}
