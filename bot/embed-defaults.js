// Default texts + settings of every Discord embed the Elvire bot sends.
// This exact file lives in /api/_lib (website) and /bot (bot). Edits made in
// Management Area -> Bot Configuration are stored in the `bot_settings` table
// and override these defaults.
const BASE = {
  enabled: true, color: '#2d2d2d', title: '', description: '', imageUrl: '', thumbnailUrl: '',
  footerText: '', footerIconUrl: '', timestamp: false,
  button: { enabled: false, label: 'Open link', url: '' }
};

const ORDER_VARS = ['order', 'items', 'subtotal', 'discount', 'coupon', 'offers', 'total', 'method', 'email', 'discord', 'roblox', 'date', 'ip'];

export const EMBED_DEFS = {
  saleComplete: {
    label: 'Sale completed (DM to the buyer, with the receipt)',
    audience: 'Direct message',
    vars: [...ORDER_VARS, 'receiptItems', 'dateText'],
    extra: ['receiptEnabled', 'receiptFileName', 'receiptTemplate'],
    defaults: {
      title: 'Sale completed',
      description: '> Your purchase #{order} has been completed successfully. Your receipt is attached to this message. Our system will also send you your products right below: you can download them within 5 minutes, before the link expires. If it expires, you can download them from our website or by using the /retrieve command in the Discord server.',
      receiptEnabled: true,
      receiptFileName: 'receipt-{order}.txt',
      receiptTemplate: [
        'ELVIRA TECHNOLOGIES - SALES RECEIPT',
        '============================================',
        '',
        'Order:               #{order}',
        'Payment date:        {dateText}',
        'Customer (Discord):  {discord}',
        'Roblox:              {roblox}',
        'Payment email:       {email}',
        'Payment method:      {method}',
        '',
        'PRODUCTS',
        '--------------------------------------------',
        '{receiptItems}',
        '--------------------------------------------',
        'Subtotal:            {subtotal}',
        'Discounts:          -{discount}',
        'Coupon applied:      {coupon}',
        'Offers applied:      {offers}',
        'TOTAL PAID:          {total}',
        '',
        'Thank you for your purchase.'
      ].join('\n')
    }
  },
  productDelivery: {
    label: 'Product delivery (DM, one per product)',
    audience: 'Direct message',
    vars: ['product', 'order', 'discord', 'roblox'],
    extra: ['downloadLabel'],
    defaults: {
      title: '{product}',
      description: 'Download your file for **{product}** by clicking the button below. The generated download link expires in 5 minutes. After that, you can download it from our website or by using /retrieve.',
      downloadLabel: 'Download file'
    }
  },
  licenseReceived: {
    label: 'License received (DM, one per product received)',
    audience: 'Direct message',
    vars: ['product', 'source', 'grantedBy', 'discord', 'roblox'],
    extra: ['downloadLabel'],
    defaults: {
      title: 'License received: {product}',
      description: '> The license for **{product}** from Elvira has just been transferred to you. You can download the file through the button below, the link expires in 5 minutes. You can also download it from our website.',
      downloadLabel: 'Download file'
    }
  },
  saleStarted: {
    label: 'Purchase in progress (sales channel)',
    audience: 'Sales channel',
    vars: ORDER_VARS,
    defaults: {
      title: 'Purchase in progress',
      description: '**Order:** #{order}\n**Customer:** {discord} (Roblox: {roblox})\n**Email:** {email}\n**IP:** {ip}\n\n**Products**\n{items}\n\n**Subtotal:** {subtotal}\n**Discounts:** -{discount}\n**Coupon:** {coupon}\n**Offers:** {offers}\n**Total to pay:** {total}\n**Payment method:** {method}\n**Started:** {date}'
    }
  },
  saleLog: {
    label: 'Sale completed (sales channel)',
    audience: 'Sales channel',
    vars: [...ORDER_VARS, 'delivery'],
    defaults: {
      title: 'Sale completed',
      description: '**Order:** #{order}\n**Customer:** {discord} (Roblox: {roblox})\n**Email:** {email}\n**IP:** {ip}\n\n**Products**\n{items}\n\n**Subtotal:** {subtotal}\n**Discounts:** -{discount}\n**Coupon:** {coupon}\n**Offers:** {offers}\n**Total paid:** {total}\n**Payment method:** {method}\n**Completed:** {date}\n**Delivery by DM:** {delivery}'
    }
  },
  saleFailed: {
    label: 'Failed sale (sales channel)',
    audience: 'Sales channel',
    vars: [...ORDER_VARS, 'errorCode', 'errorText'],
    defaults: {
      title: 'Sale not completed - Error {errorCode}',
      description: '**Order:** #{order}\n**Reason:** {errorText}\n**Customer:** {discord} (Roblox: {roblox})\n**Email:** {email}\n**IP:** {ip}\n\n**Products**\n{items}\n\n**Total:** {total}\n**Payment method:** {method}\n**Time:** {date}'
    }
  },
  securityAlert: {
    label: 'Suspicious activity (sales channel)',
    audience: 'Sales channel',
    vars: ['type', 'ip', 'discord', 'roblox', 'email', 'details', 'date'],
    defaults: {
      title: 'Suspicious activity detected',
      description: '**Type:** {type}\n**IP:** {ip}\n**Discord:** {discord}\n**Roblox:** {roblox}\n**Email:** {email}\n**Details:** {details}\n**Time:** {date}'
    }
  },
  downloadLog: {
    label: 'Product downloaded (sales channel log)',
    audience: 'Sales channel',
    vars: ['product', 'discord', 'roblox', 'email', 'ip', 'date'],
    defaults: {
      title: 'Product downloaded',
      description: '**Product:** {product}\n**User:** {discord} (Roblox: {roblox})\n**Email:** {email}\n**IP:** {ip}\n**Time:** {date}'
    }
  }
};

export const DEFAULT_PRESENCE = { status: 'online', type: 'watching', text: 'Elvira Technologies' };

export function defaultEmbed(key) {
  const d = EMBED_DEFS[key];
  return { ...BASE, button: { ...BASE.button }, ...(d ? d.defaults : {}) };
}

// saved settings override defaults field by field
export function mergeEmbed(key, saved) {
  const base = defaultEmbed(key);
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = { ...base, ...s, button: { ...base.button, ...(s.button || {}) } };
  return out;
}

export function mergePresence(saved) {
  return { ...DEFAULT_PRESENCE, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// "{order}" -> value. Unknown names become empty text.
export function renderTemplate(text, vars) {
  return String(text == null ? '' : text).replace(/\{([A-Za-z]+)\}/g, (m, k) => (vars && vars[k] != null && vars[k] !== '' ? String(vars[k]) : '—'));
}
