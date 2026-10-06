// Discount maths shared by the admin + public product endpoints.
export function applyDiscount(price, type, value) {
  const base = Math.max(Number(price) || 0, 0);
  const amount = Math.max(Number(value) || 0, 0);
  let out = base;
  if (type === 'percent') out = base * (1 - Math.min(amount, 100) / 100);
  else if (type === 'amount') out = base - amount;
  return Math.max(0, Math.round(out * 100) / 100);
}

export function applyDiscountRobux(price, type, value) {
  const base = Math.max(Math.round(Number(price) || 0), 0);
  const amount = Math.max(Number(value) || 0, 0);
  let out = base;
  if (type === 'percent') out = base * (1 - Math.min(amount, 100) / 100);
  else if (type === 'amount') out = base - amount;
  return Math.max(0, Math.round(out));
}

// What the storefront shows next to a discounted price ("-20%" / "-€5.00").
export function discountBadge(type, value, original, final) {
  if (type === 'percent' && Number(value) > 0) return '-' + trimNumber(Math.min(Number(value), 100)) + '%';
  if (type === 'amount' && Number(value) > 0 && original > final) return '-€' + (original - final).toFixed(2);
  return '';
}

function trimNumber(n) {
  return String(Math.round(n * 100) / 100);
}
