# Error codes (shown to the customer as "Error NNN")

| Code | Meaning | Who/what causes it | Channel alert |
|---|---|---|---|
| 101 | Could not start the payment with Shoppex | Shoppex down, wrong/missing `SHOPPEX_API_KEY`, missing `payments.write` scope | Yes |
| 102 | Shoppex returned an incomplete payment response | Unexpected Shoppex reply (no url / secret / id) | Yes |
| 201 | Customer left or refreshed the order page before the payment was confirmed | Closed the tab, refreshed, or the page stopped answering for 90 s | No (only listed in Sales) |
| 202 | The order session expired (30 min limit) | Took too long to pay; they must start again from `yourorder.html` | No |
| 301 | Customer cancelled the payment | Pressed cancel on the Shoppex page or on the waiting screen | Yes |
| 302 | Shoppex reported the payment as cancelled/expired | Shoppex webhook `order:cancelled` / expired | Yes |
| 303 | Payment rejected or failed at the gateway | Shoppex webhook with a failure event | Yes |
| 401 | Paid amount did not match the order total | Tampering attempt or price mismatch (order is NOT delivered) | Yes + security alert |
| 402 | Paid currency did not match | Same as 401 | Yes + security alert |
| 403 | Invoice in the confirmation did not match the order | Forged/misrouted webhook | Yes |
| 501 | Payment received but licenses could not be granted | Database problem; grant the product manually with **Give** | Yes |
| 601 | Too many orders in a short time | More than 8 orders in 10 min (user) or 12 (IP) | Security alert |
| 602 | Coupon already redeemed from this IP | Another account on the same IP used the same coupon | Security alert |

Statuses in the Sales tab: **Pending** (buyer is on the order page right now), **Completed**, **Not completed** (abandoned / cancelled / expired), **Error**.
A payment that really arrives always wins: if Shoppex confirms it later, a "Not completed" order becomes **Completed** and the products are delivered.
