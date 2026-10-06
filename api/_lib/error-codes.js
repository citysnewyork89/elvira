// Every "Error NNN" the customer can see on the order-error page.
// The same list is documented in ERROR_CODES.md.
export const ERROR_CODES = {
  101: 'Could not start the payment with Shoppex (provider unavailable or API key problem).',
  102: 'Shoppex returned an incomplete payment response.',
  201: 'The customer left or refreshed the order page before the payment was confirmed.',
  202: 'The order session expired (it took too long to pay).',
  301: 'The customer cancelled the payment on the Shoppex page.',
  302: 'Shoppex reported the payment as cancelled or expired.',
  303: 'The payment was rejected or failed at the payment gateway.',
  401: 'The paid amount did not match the order total.',
  402: 'The paid currency did not match the order currency.',
  403: 'The invoice in the payment confirmation did not match the order.',
  501: 'The payment was received but the licenses could not be granted automatically.',
  601: 'Order blocked: too many orders in a short time (suspicious activity).',
  602: 'Coupon already redeemed from this IP address.'
};
export function errorText(code) {
  return ERROR_CODES[code] || 'Unknown error.';
}
