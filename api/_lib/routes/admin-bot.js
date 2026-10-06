// /api/admin/bot  (admin only)   GET = current settings, PUT = save them.
// Stores the editable look of every embed the Elvire bot sends + the bot's status.
import { supabase } from '../db.js';
import { send, body } from '../http.js';
import { EMBED_DEFS, mergeEmbed, mergePresence, defaultEmbed, DEFAULT_PRESENCE } from '../embed-defaults.js';

const HEX = /^#?[0-9a-fA-F]{6}$/;
const URL_RE = /^https:\/\/[^\s]{3,500}$/i;
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const TYPES = ['playing', 'watching', 'listening', 'competing', 'custom'];

const str = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').slice(0, max);

function cleanEmbed(key, input) {
  const i = input && typeof input === 'object' ? input : {};
  const def = EMBED_DEFS[key];
  const out = {
    enabled: i.enabled !== false,
    color: HEX.test(String(i.color || '')) ? '#' + String(i.color).replace('#', '').toLowerCase() : '#2d2d2d',
    title: str(i.title, 256),
    description: str(i.description, 4000),
    imageUrl: '', thumbnailUrl: '', footerText: str(i.footerText, 2048), footerIconUrl: '',
    timestamp: i.timestamp === true,
    button: { enabled: false, label: str(i.button && i.button.label, 80) || 'Open link', url: '' }
  };
  for (const [field, max] of [['imageUrl', 500], ['thumbnailUrl', 500], ['footerIconUrl', 500]]) {
    const v = str(i[field], max).trim();
    if (v && !URL_RE.test(v)) return { error: `${def.label}: "${field}" must be a full https:// link.` };
    out[field] = v;
  }
  const b = i.button || {};
  const url = str(b.url, 500).trim();
  if (b.enabled === true) {
    if (!URL_RE.test(url)) return { error: `${def.label}: the link button needs a full https:// link.` };
    if (!out.button.label.trim()) return { error: `${def.label}: the link button needs a label.` };
    out.button.enabled = true;
  }
  out.button.url = url && URL_RE.test(url) ? url : '';
  if (!out.title.trim() && !out.description.trim()) return { error: `${def.label}: add a title or a description.` };
  for (const extra of def.extra || []) {
    if (extra === 'receiptEnabled') out.receiptEnabled = i.receiptEnabled !== false;
    if (extra === 'receiptTemplate') out.receiptTemplate = str(i.receiptTemplate, 6000) || defaultEmbed(key).receiptTemplate;
    if (extra === 'receiptFileName') {
      let name = str(i.receiptFileName, 80).trim().replace(/[^A-Za-z0-9._{}-]/g, '_') || 'receipt-{order}.txt';
      if (!/\.txt$/i.test(name)) name += '.txt';
      out.receiptFileName = name;
    }
    if (extra === 'downloadLabel') out.downloadLabel = str(i.downloadLabel, 80).trim() || defaultEmbed(key).downloadLabel;
  }
  return { value: out };
}

function payload(row) {
  const saved = (row && row.embeds) || {};
  const embeds = {};
  for (const key of Object.keys(EMBED_DEFS)) embeds[key] = mergeEmbed(key, saved[key]);
  const meta = {};
  for (const [key, d] of Object.entries(EMBED_DEFS)) meta[key] = { label: d.label, audience: d.audience, vars: d.vars, extra: d.extra || [], defaults: defaultEmbed(key) };
  return { embeds, meta, presence: mergePresence(row && row.presence), defaultPresence: DEFAULT_PRESENCE };
}

export async function handleBot(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('bot_settings').select('*').eq('id', 'main').maybeSingle();
    if (error) return send(res, 500, { error: 'Could not load the bot settings. Did you run the latest supabase-setup.sql?', detail: error.message });
    return send(res, 200, payload(data));
  }
  if (req.method === 'PUT') {
    const b = body(req);
    const embeds = {};
    for (const key of Object.keys(EMBED_DEFS)) {
      if (!b.embeds || b.embeds[key] === undefined) continue;
      const r = cleanEmbed(key, b.embeds[key]);
      if (r.error) return send(res, 400, { error: r.error });
      embeds[key] = r.value;
    }
    const row = { id: 'main', updated_at: new Date().toISOString() };
    const { data: current } = await supabase.from('bot_settings').select('*').eq('id', 'main').maybeSingle();
    row.embeds = { ...((current && current.embeds) || {}), ...embeds };
    row.presence = (current && current.presence) || {};
    if (b.presence) {
      const p = b.presence;
      if (!STATUSES.includes(p.status) || !TYPES.includes(p.type)) return send(res, 400, { error: 'Choose a valid bot status and activity type.' });
      const text = str(p.text, 120).trim();
      if (!text) return send(res, 400, { error: 'Enter the text of the bot status (for example: Elvira Technologies).' });
      row.presence = { status: p.status, type: p.type, text };
    }
    const { data, error } = await supabase.from('bot_settings').upsert(row).select().maybeSingle();
    if (error) return send(res, 500, { error: 'Could not save the bot settings.', detail: error.message });
    return send(res, 200, payload(data || row));
  }
  send(res, 405, { error: 'Method not allowed' });
}
