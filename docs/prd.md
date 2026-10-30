# GoShop — Product Requirements (MVP)

Status: draft for the course, owner: GoShop team, last reviewed in Bab 1.

## Problem

Small Indonesian brands (clothing, snacks, crafts) mostly sell through marketplaces and Instagram/WhatsApp chats. Marketplaces take a commission and own the customer relationship; chat selling does not scale, since stock, payment confirmation and shipping are tracked by hand. These brands want their own online shop that buyers can use from the browser or a phone, with automatic payment confirmation and stock that is always correct.

GoShop is that shop: a single-brand online store (not a marketplace) with a storefront, an admin dashboard and a mobile app.

## Actors

| Actor | Who | Main jobs |
|---|---|---|
| **Pembeli (buyer)** | Shoppers in Indonesia, mostly on phones | Find products, add to cart, check out, pay, track the order |
| **Penjual (seller)** | Store staff of the brand | Manage products, variants, stock and photos; process orders (pack, ship, enter the airway bill) |
| **Admin** | The store owner or operator | Everything a seller can do, plus users and roles, categories, refunds/cancellations and store settings |

Sellers and admins use the same admin dashboard; what they can do is decided by their role.

## Goals

1. A buyer can go from product page to paid order in under 2 minutes on a phone.
2. Payment status is updated automatically from Midtrans; no one confirms transfers by hand.
3. Stock never goes negative, even when two buyers check out the last item at the same time.
4. One API serves the web storefront, the admin dashboard and the mobile app.

## Non-goals (for the MVP)

- Multiple vendors (a marketplace), commissions, seller payouts.
- Currencies other than IDR, or shipping outside Indonesia.
- Building our own payment gateway or courier integration beyond rate lookup.
- Loyalty points, vouchers and flash sales (flash sales appear as the capstone in Bab 20).

## MVP features

Prices are in rupiah (IDR) without decimals, e.g. Rp149.000. Payments go through Midtrans (sandbox in this course): virtual account, QRIS and e-wallets.

| # | Feature | Actor | Course chapter |
|---|---|---|---|
| F1 | Health/readiness endpoints, structured logs, consistent JSON errors | — | Bab 2 |
| F2 | Catalog: categories, products with variants (size/colour), SKU, price, stock | buyer | Bab 3 |
| F3 | Browse and search products: filter by category, sort by newest/price, cursor pagination | buyer | Bab 3 (API), Bab 8–9 (web), Bab 14 (mobile) |
| F4 | Register and log in with email/password or Google, email verification, password reset | buyer, seller, admin | Bab 4 |
| F5 | Address book (recipient, phone, city, postal code) | buyer | Bab 4–5 |
| F6 | Cart (guest cart merged on login), checkout with courier choice (JNE, J&T, SiCepat) and shipping fee | buyer | Bab 5 |
| F7 | Orders with a clear status: pending payment → paid → processing → shipped → completed, or cancelled (an unpaid order is cancelled automatically when its payment deadline passes) | buyer, seller | Bab 5 |
| F8 | Pay with Midtrans Snap; payment status from the webhook; order/notification emails via the worker | buyer | Bab 6 |
| F9 | Product photo upload to S3 storage | seller | Bab 6 |
| F10 | Web storefront: catalog, product page, cart, checkout, payment, SEO | buyer | Bab 7–11 |
| F11 | Admin dashboard: products, stock, orders, realtime new-order feed | seller, admin | Bab 12 |
| F12 | Mobile app (Android + iOS): catalog, search, cart, checkout, push notifications, review photos | buyer | Bab 13–17 |
| F13 | AI: semantic product search and a shopping assistant | buyer | Bab 18 |
| F14 | Production deploy on Railway with tracing and metrics | — | Bab 19 |

## Success metrics

| Metric | Target for the MVP |
|---|---|
| Checkout conversion (cart → paid order) | ≥ 30% |
| Median time from product page to paid order (mobile) | < 2 minutes |
| Orders paid but not marked paid after 5 minutes | 0 |
| Oversold orders (stock below zero) | 0 |
| API p95 latency for catalog endpoints | < 200 ms |
| API availability | ≥ 99.5% per month |

## Open questions

1. Shipping fee: a live courier rate API (RajaOngkir/Biteship) or a fixed table per destination city for the MVP?
2. How long is the payment deadline (`payment_expires_at`) for an unpaid order? Stock is taken at checkout and returned when the order expires, so the deadline should match the payment expiry we set on each Midtrans transaction.
3. Do we need guest checkout, or must buyers log in to pay?
4. Product reviews: only from buyers with a completed order?
5. ~~Who may cancel a paid order, and who handles the refund in Midtrans — seller or admin only?~~ Answered in Bab 12: only an admin may cancel an order (`POST /v1/admin/orders/{id}/cancel`); sellers process, ship and complete orders. Refunding a cancelled paid order in Midtrans is still manual and stays with the admin.
