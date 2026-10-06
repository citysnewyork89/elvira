// Website status bar + information window (the "Interactivity" tab).
import { supabase } from '../db.js';
import { send, body, cleanText, safeLink } from '../http.js';

// Pages the information window can be limited to.
export const SITE_PAGES = [
  { key: 'index.html', label: 'Home' },
  { key: 'store.html', label: 'Store' },
  { key: 'product.html', label: 'Product page' },
  { key: 'dashboard.html', label: 'Dashboard' },
  { key: 'licences.html', label: 'Your Licences' },
  { key: 'helpcenter.html', label: 'Help Center' }
];

const DEFAULTS = {
  statusBar: { active: false, text: '', linkEnabled: false, linkText: '', linkUrl: '' },
  infoWindow: {
    active: false,
    title: '',
    subtext: '',
    button1: { text: '', url: '' },
    button2: { text: '', url: '' },
    closable: true,
    pagesMode: 'all',
    pages: []
  }
};

function buttonShape(b) {
  const text = cleanText(b && b.text, 40);
  const url = safeLink(b && b.url);
  return text && url ? { text, url } : { text: '', url: '' };
}

export function mergeConfig(row) {
  const sb = (row && row.status_bar) || {};
  const iw = (row && row.info_window) || {};
  return {
    statusBar: { ...DEFAULTS.statusBar, ...sb },
    infoWindow: {
      ...DEFAULTS.infoWindow,
      ...iw,
      button1: { ...DEFAULTS.infoWindow.button1, ...(iw.button1 || {}) },
      button2: { ...DEFAULTS.infoWindow.button2, ...(iw.button2 || {}) }
    },
    updatedAt: (row && row.updated_at) || null
  };
}

export async function loadConfig() {
  const { data } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
  return mergeConfig(data);
}

export function normalizeConfig(b) {
  const sbIn = b.statusBar || {};
  const iwIn = b.infoWindow || {};

  const statusBar = {
    active: sbIn.active === true,
    text: cleanText(sbIn.text, 240),
    linkEnabled: false,
    linkText: '',
    linkUrl: ''
  };
  if (sbIn.linkEnabled === true) {
    const url = safeLink(sbIn.linkUrl);
    const linkText = cleanText(sbIn.linkText, 60);
    if (!url || !linkText) return { error: 'For the status bar link, enter both the link text and a valid link.' };
    statusBar.linkEnabled = true;
    statusBar.linkText = linkText;
    statusBar.linkUrl = url;
  }
  if (statusBar.active && !statusBar.text) return { error: 'Enter the status bar text before activating it.' };

  const allowedPages = SITE_PAGES.map((p) => p.key);
  const pagesMode = iwIn.pagesMode === 'selected' ? 'selected' : 'all';
  const pages = (Array.isArray(iwIn.pages) ? iwIn.pages : []).filter((p) => allowedPages.includes(p));

  const infoWindow = {
    active: iwIn.active === true,
    title: cleanText(iwIn.title, 100),
    subtext: cleanText(iwIn.subtext, 1200),
    button1: buttonShape(iwIn.button1),
    button2: buttonShape(iwIn.button2),
    closable: iwIn.closable !== false,
    pagesMode,
    pages: pagesMode === 'selected' ? [...new Set(pages)] : []
  };
  if (infoWindow.active && !infoWindow.title) return { error: 'Enter a title for the information window before activating it.' };
  if (infoWindow.active && pagesMode === 'selected' && !infoWindow.pages.length) {
    return { error: 'Select at least one page for the information window.' };
  }

  return { value: { statusBar, infoWindow } };
}

export async function handleSite(req, res) {
  if (req.method === 'GET') {
    const config = await loadConfig();
    return send(res, 200, { ...config, pages: SITE_PAGES });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const parsed = normalizeConfig(body(req));
    if (parsed.error) return send(res, 400, { error: parsed.error });

    const { error } = await supabase.from('site_settings').upsert(
      {
        id: 1,
        status_bar: parsed.value.statusBar,
        info_window: parsed.value.infoWindow,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    );
    if (error) {
      console.error('Save site settings error:', error);
      return send(res, 500, { error: 'Could not save the settings.' });
    }
    return send(res, 200, { success: true });
  }

  send(res, 405, { error: 'Method not allowed' });
}
