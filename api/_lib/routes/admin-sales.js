// /api/admin/sales...  (admin only)
//   GET    sales                 list of sales
//   GET    sales/:id             every detail of one sale
//   DELETE sales/:id[?revoke=1]  delete a sale (optionally revoke the licenses it granted)
import { supabase } from '../db.js';
import { send, UUID_RE } from '../http.js';
import { shapeSale, sweepPending } from '../shop-core.js';

async function list(res) {
  await sweepPending();
  const { data, error } = await supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return send(res, 500, { error: 'Could not load the sales.', detail: error.message });
  const ids = [...new Set((data || []).map((p) => p.user_id).filter(Boolean))];
  const { data: users } = ids.length ? await supabase.from('users').select('*').in('id', ids) : { data: [] };
  const uMap = new Map((users || []).map((u) => [u.id, u]));
  send(res, 200, { sales: (data || []).map((p) => shapeSale(p, uMap.get(p.user_id))) });
}

async function one(res, id) {
  await sweepPending();
  const { data: p, error } = await supabase.from('purchases').select('*').eq('id', id).maybeSingle();
  if (error) return send(res, 500, { error: 'Could not load the sale.', detail: error.message });
  if (!p) return send(res, 404, { error: 'Sale not found.' });
  const { data: buyer } = p.user_id ? await supabase.from('users').select('*').eq('id', p.user_id).maybeSingle() : { data: null };
  const { data: lic } = await supabase.from('licenses').select('id,product_name,acquired_at,source').eq('purchase_id', id);
  send(res, 200, {
    sale: {
      ...shapeSale(p, buyer),
      licenses: (lic || []).map((l) => ({ id: l.id, productName: l.product_name, acquiredAt: l.acquired_at, source: l.source }))
    }
  });
}

async function remove(req, res, id, query) {
  if (query.revoke === '1') {
    await supabase.from('licenses').delete().eq('purchase_id', id);
  }
  const { data, error } = await supabase.from('purchases').delete().eq('id', id).select('id');
  if (error) {
    console.error('Delete sale error:', error);
    return send(res, 500, { error: 'Could not delete the sale.', detail: error.message });
  }
  if (!data || !data.length) return send(res, 404, { error: 'Sale not found.' });
  send(res, 200, { success: true });
}

export async function handleSales(req, res, parts, query) {
  const id = parts[1];
  if (!id) {
    if (req.method === 'GET') return list(res);
    return send(res, 405, { error: 'Method not allowed' });
  }
  if (!UUID_RE.test(id)) return send(res, 400, { error: 'Invalid sale id.' });
  if (req.method === 'GET') return one(res, id);
  if (req.method === 'DELETE') return remove(req, res, id, query || {});
  send(res, 405, { error: 'Method not allowed' });
}
