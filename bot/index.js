// Elvire — delivery + sales + security bot for the Elvira website.
// It reads the `bot_events` queue the website fills, sends the DMs, posts the logs in the
// sales channel and serves /retrieve. Every embed's look comes from Management Area ->
// Bot Configuration (table `bot_settings`), refreshed live without restarting.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, REST, Routes, SlashCommandBuilder, MessageFlags, ActivityType
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { EMBED_DEFS, mergeEmbed, mergePresence, renderTemplate } from './embed-defaults.js';

const TTL_MS = 5 * 60 * 1000;
const need = ['DISCORD_BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error('Missing environment variables:', missing.join(', ')); process.exit(1); }

let SITE = process.env.SITE_URL.trim().replace(/\/+$/, '');
if (!/^https?:\/\//i.test(SITE)) SITE = 'https://' + SITE; // Discord rejects buttons without https://
const CHANNEL_ID = (process.env.SALES_CHANNEL_ID || '1556033428099432479').trim();
const db = createClient(process.env.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, ''), process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });
const eur = (n) => '€' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const when = (d) => `<t:${Math.floor(new Date(d || Date.now()).getTime() / 1000)}:F>`;
const ERR = {
  101: 'Could not start the payment with Shoppex (provider unavailable or API key problem).', 102: 'Shoppex returned an incomplete payment response.',
  201: 'The customer left or refreshed the order page before the payment was confirmed.', 202: 'The order session expired (it took too long to pay).',
  301: 'The customer cancelled the payment on the Shoppex page.', 302: 'Shoppex reported the payment as cancelled or expired.',
  303: 'The payment was rejected or failed at the payment gateway.', 401: 'The paid amount did not match the order total.',
  402: 'The paid currency did not match the order currency.', 403: 'The invoice in the payment confirmation did not match the order.',
  501: 'The payment was received but the licenses could not be granted automatically.', 601: 'Order blocked: too many orders in a short time (suspicious activity).',
  602: 'Coupon already redeemed from this IP address.'
};

// ---------- live configuration ----------
let cfgCache = { at: 0, row: null };
async function config() {
  if (Date.now() - cfgCache.at < 15000) return cfgCache.row;
  const { data } = await db.from('bot_settings').select('*').eq('id', 'main').maybeSingle();
  cfgCache = { at: Date.now(), row: data || { embeds: {}, presence: {} } };
  return cfgCache.row;
}
const embedCfg = async (key) => mergeEmbed(key, ((await config()).embeds || {})[key]);

let lastPresence = '';
async function applyPresence() {
  if (!client.isReady()) return;
  const p = mergePresence((await config()).presence);
  const sig = JSON.stringify(p);
  if (sig === lastPresence) return;
  const types = { playing: ActivityType.Playing, watching: ActivityType.Watching, listening: ActivityType.Listening, competing: ActivityType.Competing, custom: ActivityType.Custom };
  const activity = p.type === 'custom' ? { name: 'Custom Status', state: p.text, type: ActivityType.Custom } : { name: p.text, type: types[p.type] };
  client.user.setPresence({ status: p.status, activities: [activity] });
  lastPresence = sig;
}

// ---------- embed building ----------
function buildMessage(cfg, vars, extraRows) {
  const e = new EmbedBuilder().setColor(parseInt(String(cfg.color || '#2d2d2d').replace('#', ''), 16) || 0x2d2d2d);
  const title = renderTemplate(cfg.title, vars).slice(0, 256);
  const desc = renderTemplate(cfg.description, vars).slice(0, 4000);
  if (title.trim()) e.setTitle(title);
  if (desc.trim()) e.setDescription(desc);
  if (!title.trim() && !desc.trim()) e.setDescription('\u200b');
  if (cfg.imageUrl) e.setImage(cfg.imageUrl);
  if (cfg.thumbnailUrl) e.setThumbnail(cfg.thumbnailUrl);
  const footer = renderTemplate(cfg.footerText, vars);
  if (cfg.footerText && footer.trim()) e.setFooter(cfg.footerIconUrl ? { text: footer.slice(0, 2048), iconURL: cfg.footerIconUrl } : { text: footer.slice(0, 2048) });
  if (cfg.timestamp) e.setTimestamp();
  const buttons = [...(extraRows || [])];
  if (cfg.button && cfg.button.enabled && /^https:\/\//i.test(cfg.button.url || '')) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(cfg.button.label || 'Open link').slice(0, 80)).setURL(cfg.button.url));
  }
  const msg = { embeds: [e] };
  if (buttons.length) msg.components = [new ActionRowBuilder().addComponents(buttons.slice(0, 5))];
  return msg;
}

// ---------- download links (same format the website uses) ----------
async function makeLink({ userId, productId, licenseId }) {
  const token = randomBytes(32).toString('base64url');
  const { error } = await db.from('download_tokens').insert({
    token_hash: createHash('sha256').update(token).digest('hex'),
    user_id: userId, product_id: productId, license_id: licenseId || null,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(), created_by: 'bot'
  });
  if (error) throw new Error('download token: ' + error.message);
  return `${SITE}/download.html?t=${token}`;
}
const downloadButton = (label, url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(label || 'Download file').slice(0, 80)).setURL(url);

// ---------- variables ----------
async function loadBuyer(p) {
  if (!p.user_id) return null;
  const { data } = await db.from('users').select('*').eq('id', p.user_id).maybeSingle();
  return data;
}
function saleVars(p, buyer, extra) {
  const items = (p.items || []).map((i) => `• ${i.name} — ${eur(i.finalPrice)}`).join('\n') || '—';
  return {
    order: p.order_code, items, subtotal: eur(p.subtotal_eur), discount: eur(p.discount_amount), coupon: p.discount_code || 'None',
    offers: (p.offers || []).join(', ') || 'None', total: `${eur(p.amount_eur)} ${p.currency || 'EUR'}`, method: p.payment_method || 'Not selected yet',
    email: p.customer_email || '—', discord: buyer ? buyer.discord_username : p.buyer_discord || '—', roblox: (buyer && buyer.roblox_username) || '—',
    date: when(p.paid_at || p.created_at), ip: p.buyer_ip || '—', ...(extra || {})
  };
}
// The receipt (.txt) is built from the template edited in Management Area -> Bot Configuration.
function receiptFor(p, buyer, cfg) {
  const itemsText = (p.items || []).map((i) =>
    `${i.name}\n   Price: ${eur(i.originalPrice)} | Product discount: -${eur(i.productDiscount)} | Offer: -${eur(i.offerDiscount)}${i.offerName ? ' (' + i.offerName + ')' : ''} | Coupon: -${eur(i.couponDiscount)}\n   Final: ${eur(i.finalPrice)}`).join('\n\n');
  const vars = { ...saleVars(p, buyer), receiptItems: itemsText || '—', dateText: new Date(p.paid_at || p.created_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' };
  const text = renderTemplate(cfg.receiptTemplate || '{receiptItems}', vars);
  let name = renderTemplate(cfg.receiptFileName || 'receipt-{order}.txt', vars).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  if (!/\.txt$/i.test(name)) name += '.txt';
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name });
}

// ---------- senders ----------
async function postChannel(key, vars) {
  try {
    const cfg = await embedCfg(key);
    if (!cfg.enabled) return;
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch || !ch.isTextBased()) throw new Error('The sales channel was not found or is not a text channel');
    await ch.send(buildMessage(cfg, vars));
  } catch (err) { console.error(`Channel post (${key}) failed:`, err.message); }
}

async function deliverSale(p, buyer) {
  if (!buyer || !buyer.discord_id) throw new Error('Buyer has no Discord id');
  const user = await client.users.fetch(buyer.discord_id);
  const vars = saleVars(p, buyer);
  const head = await embedCfg('saleComplete');
  if (head.enabled) {
    const msg = buildMessage(head, vars);
    if (head.receiptEnabled !== false) msg.files = [receiptFor(p, buyer, head)];
    await user.send(msg);
  }
  const cfg = await embedCfg('productDelivery');
  if (!cfg.enabled) return;
  for (const item of p.items || []) {
    const { data: lic } = await db.from('licenses').select('id').eq('user_id', p.user_id).eq('product_id', item.productId).limit(1);
    const url = await makeLink({ userId: p.user_id, productId: item.productId, licenseId: lic && lic[0] && lic[0].id });
    await user.send(buildMessage(cfg, { ...vars, product: item.name }, [downloadButton(cfg.downloadLabel, url)]));
  }
}

async function deliverLicense(payload) {
  const cfg = await embedCfg('licenseReceived');
  if (!cfg.enabled) return;
  const { data: u } = await db.from('users').select('*').eq('id', payload.userId).maybeSingle();
  if (!u || !u.discord_id) throw new Error('Recipient has not logged in yet (no Discord id)');
  const url = payload.productId ? await makeLink({ userId: u.id, productId: payload.productId, licenseId: payload.licenseId }) : null;
  const user = await client.users.fetch(u.discord_id);
  await user.send(buildMessage(cfg, { product: payload.productName, source: payload.source, grantedBy: payload.grantedBy || '—', discord: u.discord_username, roblox: u.roblox_username || '—' },
    url ? [downloadButton(cfg.downloadLabel, url)] : []));
}

// ---------- queue ----------
async function sweep() {
  const now = new Date().toISOString();
  await db.from('purchases').update({ status: 'unpaid', failure_code: 202, failure_reason: ERR[202] }).eq('status', 'pending').eq('provider', 'shoppex').lt('expires_at', now);
  await db.from('purchases').update({ status: 'unpaid', failure_code: 201, failure_reason: ERR[201] }).eq('status', 'pending').eq('provider', 'shoppex').lt('last_seen_at', new Date(Date.now() - 90000).toISOString());
}

let busy = false;
async function handle(ev) {
  const payload = ev.payload || {};
  if (ev.kind === 'security_alert') {
    return postChannel('securityAlert', { type: payload.type, ip: payload.ip, discord: payload.discord || '—', roblox: payload.roblox || '—', email: payload.email || '—', details: payload.details || '—', date: when(ev.created_at) });
  }
  if (ev.kind === 'download_log') {
    return postChannel('downloadLog', { product: payload.productName, discord: payload.discord || '—', roblox: payload.roblox || '—', email: payload.email || '—', ip: payload.ip || '—', date: when(ev.created_at) });
  }
  if (ev.kind === 'license_received') return deliverLicense(payload);

  const { data: p } = await db.from('purchases').select('*').eq('id', ev.purchase_id).maybeSingle();
  if (!p) return;
  const buyer = await loadBuyer(p);
  if (ev.kind === 'sale_started') {
    return postChannel('saleStarted', saleVars({ ...p, paid_at: null }, buyer));
  }
  if (ev.kind === 'sale_failed') {
    return postChannel('saleFailed', saleVars(p, buyer, { errorCode: p.failure_code || '—', errorText: p.failure_reason || ERR[p.failure_code] || 'Unknown error', date: when(ev.created_at) }));
  }
  if (ev.kind === 'sale_complete') {
    let delivery = 'Sent successfully'; let state = 'delivered';
    try { await deliverSale(p, buyer); } catch (err) {
      console.error('DM failed for', p.order_code, err.message);
      delivery = 'Could not send the DM (DMs closed). The customer can download from the website or with /retrieve.'; state = 'dm_failed';
    }
    await db.from('purchases').update({ delivery_status: state }).eq('id', p.id);
    return postChannel('saleLog', saleVars(p, buyer, { delivery }));
  }
}

async function tick() {
  if (busy || !client.isReady()) return;
  busy = true;
  try {
    await sweep();
    await applyPresence();
    await db.from('bot_events').update({ status: 'pending' }).eq('status', 'processing').lt('claimed_at', new Date(Date.now() - 3 * 60 * 1000).toISOString());
    const { data: events } = await db.from('bot_events').select('*').eq('status', 'pending').order('created_at').limit(10);
    for (const ev of events || []) {
      const { data: claimed } = await db.from('bot_events').update({ status: 'processing', claimed_at: new Date().toISOString(), attempts: ev.attempts + 1 }).eq('id', ev.id).eq('status', 'pending').select().maybeSingle();
      if (!claimed) continue;
      try {
        await handle(ev);
        await db.from('bot_events').update({ status: 'done', processed_at: new Date().toISOString(), last_error: null }).eq('id', ev.id);
      } catch (err) {
        console.error('Event failed', ev.id, ev.kind, err.message);
        const final = ev.attempts + 1 >= 4 || /not logged in|no Discord id|yet/i.test(err.message);
        await db.from('bot_events').update({ status: final ? 'failed' : 'pending', last_error: String(err.message).slice(0, 300) }).eq('id', ev.id);
      }
    }
  } catch (err) { console.error('Tick error:', err.message); } finally { busy = false; }
}

// ---------- /retrieve ----------
async function retrieve(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const { data: user } = await db.from('users').select('*').eq('discord_id', i.user.id).maybeSingle();
  if (!user || user.blocked) return i.editReply({ content: `We could not find an active account. Please log in at ${SITE} first.` });
  const { data: lic } = await db.from('licenses').select('id,product_id,product_name').eq('user_id', user.id).not('product_id', 'is', null).order('acquired_at', { ascending: false }).limit(10);
  if (!lic || !lic.length) return i.editReply({ content: 'You do not own any products yet.' });
  const rows = [];
  for (let k = 0; k < lic.length; k += 5) {
    const row = new ActionRowBuilder();
    for (const l of lic.slice(k, k + 5)) row.addComponents(downloadButton(String(l.product_name).slice(0, 70), await makeLink({ userId: user.id, productId: l.product_id, licenseId: l.id })));
    rows.push(row);
  }
  await i.editReply({ content: 'Your products (the links expire in 5 minutes):', components: rows });
}

client.on('interactionCreate', async (i) => {
  try { if (i.isChatInputCommand() && i.commandName === 'retrieve') await retrieve(i); }
  catch (err) { console.error('Interaction error:', err.message); if (i.deferred || i.replied) i.editReply({ content: 'Something went wrong. Please try again.' }).catch(() => {}); }
});

client.once('ready', async () => {
  console.log('Elvire online as', client.user.tag, '| site:', SITE, '| channel:', CHANNEL_ID);
  const cmd = new SlashCommandBuilder().setName('retrieve').setDescription('Generate new download links for your products').toJSON();
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    if (process.env.GUILD_ID) await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: [cmd] });
    else await rest.put(Routes.applicationCommands(client.user.id), { body: [cmd] });
  } catch (err) { console.error('Command registration failed:', err.message); }
  setInterval(tick, 5000);
  tick();
});

http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }).listen(process.env.PORT || 3000);
process.on('unhandledRejection', (e) => console.error('Unhandled:', e));
client.login(process.env.DISCORD_BOT_TOKEN);
