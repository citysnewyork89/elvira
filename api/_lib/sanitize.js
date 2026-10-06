// Rich text (product description / instructions) is rendered with innerHTML on
// the public store, so it is ALWAYS cleaned on save with a strict allow-list.
// Self-contained (no external packages): nothing to install, nothing that can
// fail to load on the server.
//
// How it stays safe: the input is split into tags and text. Text is always
// escaped. Only allow-listed tags survive, rebuilt from scratch with allow-listed
// attributes (href only http/https/mailto, style only a few harmless properties).
// Everything else is dropped or shown as plain text. Open tags are always closed.

const ALLOWED_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'span', 'div', 'a', 'h2', 'h3', 'blockquote']);
const VOID_TAGS = new Set(['br']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'textarea', 'noscript', 'template', 'svg', 'math', 'title', 'head']);
const ALLOWED_ATTRS = { a: ['href'], span: ['style'], div: ['style'], p: ['style'], li: ['style'] };

const STYLE_RULES = {
  color: /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i,
  'text-align': /^(left|right|center|justify)$/i,
  'font-weight': /^(bold|[1-9]00)$/i,
  'font-style': /^italic$/i,
  'text-decoration': /^(underline|line-through)$/i
};

const TOKEN_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeText(value) {
  return String(value)
    .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cleanHref(raw) {
  const v = String(raw || '').trim();
  if (!v || v.length > 1000) return '';
  if (!/^(https?:\/\/|mailto:)[^\s"'<>`\\]*$/i.test(v)) return '';
  return v;
}

function cleanStyle(raw) {
  const out = [];
  for (const part of String(raw || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (STYLE_RULES[prop] && STYLE_RULES[prop].test(val)) out.push(prop + ':' + val.toLowerCase());
  }
  return out.join(';');
}

function buildAttrs(tag, rawAttrs) {
  const allowed = ALLOWED_ATTRS[tag] || [];
  const found = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(rawAttrs || ''))) {
    const name = m[1].toLowerCase();
    if (!allowed.includes(name) || found[name] !== undefined) continue;
    found[name] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  }
  let out = '';
  if (tag === 'a') {
    const href = cleanHref(found.href);
    if (href) out += ' href="' + escapeAttr(href) + '"';
    out += ' target="_blank" rel="noopener noreferrer"';
  } else if (found.style !== undefined) {
    const style = cleanStyle(found.style);
    if (style) out += ' style="' + escapeAttr(style) + '"';
  }
  return out;
}

export async function sanitizerAvailable() {
  return true;
}

export function cleanHtmlSync(html) {
  const input = String(html || '').slice(0, 60000);
  const out = [];
  const stack = [];
  let skipUntil = null; // name of a tag whose whole content is being dropped
  let m;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(input))) {
    const token = m[0];
    const name = m[1] ? m[1].toLowerCase() : '';

    if (skipUntil) {
      if (name === skipUntil && token.startsWith('</')) skipUntil = null;
      continue;
    }
    if (token.startsWith('<!--')) continue;

    if (!name) {
      out.push(escapeText(token)); // plain text (or a stray "<")
      continue;
    }

    const closing = token.startsWith('</');
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*>$/.test(token)) skipUntil = name;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // unknown tag: drop the tag, keep its text

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out.push('</' + stack.pop() + '>');
      continue;
    }

    if (VOID_TAGS.has(name)) {
      out.push('<' + name + '>');
      continue;
    }
    if (stack.length >= 50) continue;
    out.push('<' + name + buildAttrs(name, m[2]) + '>');
    stack.push(name);
  }

  while (stack.length) out.push('</' + stack.pop() + '>');
  return out.join('').trim();
}

export async function cleanHtml(html) {
  return cleanHtmlSync(html);
}

export function htmlToTextSync(html, max) {
  const text = String(html || '')
    .replace(/<(script|style|iframe|object|embed|textarea|noscript|template|svg|math|title|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return max ? text.slice(0, max) : text;
}

export async function htmlToText(html, max) {
  return htmlToTextSync(html, max);
}
