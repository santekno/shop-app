# 0006. Keep carts in PostgreSQL and create an order in one guarded transaction

- Status: Accepted
- Date: 2026-10-23
- Chapter: Bab 5

## Context

Bab 5 turns the catalog into a shop: a cart, a checkout with a courier and a voucher, and orders that move through a life cycle (`docs/prd.md` F6, F7). The physical model was reviewed in Bab 1 (`docs/erd.md`): order lines copy the product data, variants are archived and never deleted, stock lives on `product_variants` with a `version` column, and the order status is a closed set with CHECKs.

Forces:

- **Money must be exact.** Rupiah has no minor unit in practice. A float total that is off by one rupiah is a bug a customer will notice.
- **Two buyers, one last item.** The PRD's target for oversold orders is 0, under concurrent checkouts.
- **Phones retry.** A mobile client on a bad network sends the same checkout twice; the buyer must not get two orders.
- **Guests shop too.** A buyer fills a cart before logging in and expects to find it after logging in, on the web and in the app (no cookies there).
- **The shipping fee comes from a courier API** (RajaOngkir or Biteship) that can be slow, down, or not configured on a developer's machine.
- **Payments arrive in Bab 6**, notifications in Bab 6, the admin dashboard in Bab 12. Bab 5 must leave clean seams for them, not half-built versions.
- **Readers copy the code.** Each decision must fit one article.

## Decision

We will keep **carts in PostgreSQL**, compute every amount in **whole rupiah**, and create an order, its lines, the voucher use, the stock decrement and an outbox event in **one transaction** that locks the buyer's row first and the variants in id order. Every status change is a **conditional `UPDATE`** that names the statuses it may start from.

### Money

- Every amount is a `bigint` of whole rupiah in the database and an `int64` in Go. Sums and `unit_price × quantity` are exact in integers.
- The only division is a percent discount. It is computed with sdk **`moneyx`** (`big.Rat`, exact) and rounded once, to the nearest rupiah with halves away from zero (`moneyx.Dec.RoundIDR`). Then the discount is capped at the voucher's `max_discount` and at the subtotal. The shipping fee is never discounted.
- `orders` CHECKs that `total = subtotal - discount + shipping_fee` and `0 ≤ discount ≤ subtotal`, and `order_items` that `line_total = unit_price * quantity`, so a bug cannot store a total that does not add up.
- The calculator (`order.CalculateTotals`) is a pure function of its inputs, so every rounding case is a row in a table test.

### Carts

- One cart per user (`carts.user_id` UNIQUE). A **guest cart** belongs to whoever holds its **cart token**.
- The cart token has the shape of ADR 0005's opaque tokens: `<cart id>.<32 random bytes, base64url>`. Only the SHA-256 of the secret is stored (`carts.token_hash`); the row is found by id and the hash compared in constant time.
- It travels in the **`X-Cart-Token` header**, not a cookie. The mobile app has no cookie jar to speak of, a header works the same for all three clients, and a header is never sent by the browser on its own, so a guest cart needs no CSRF protection. The API returns the token once, in the body and the header of the response that created the cart.
- A cart line is `(cart_id, variant_id)` with a quantity of 1–99 and **the price the buyer saw** when they last added or changed it (`cart_items.unit_price`). At most 50 lines per cart.
- **Merging** is an explicit call, `POST /v1/cart/merge`, made by the client right after any login (password, Google, registration) with the guest token. Auth stays unaware of carts. For a variant in both carts the merged quantity is `max(user_qty, min(user_qty + guest_qty, 99, stock))`: the guest's quantity is added up to the per-line cap and the stock on hand, and **a merge never lowers what the user's cart already had**. A guest line whose variant is sold out or no longer sellable is not carried over. The guest cart is deleted, so a token can be merged once.

### Checkout

- `POST /v1/checkout` takes `address_id`, `courier`, `service`, an optional `voucher_code`, and the required `Idempotency-Key` header. The lines come from the server-side cart, never from the body, and the price, stock, product status and archived state of each are **re-validated inside the transaction**. Any problem answers **409 `CHECKOUT_PROBLEMS`** with one entry per problem line (`unavailable`, `insufficient_stock` with the available quantity, `price_changed` with both prices). A buyer accepts a new price by saving the line again (`PATCH` with the same quantity).
- **The cart is locked and read again inside the transaction.** The lines, prices and fee were read before it (the shipping quote must not hold a lock), so after locking the buyer the transaction locks the buyer's cart row and compares its lines (variant, quantity, price seen) with what was quoted. Any difference is 409 `CART_CHANGED`. This is what stops one cart from becoming two orders when the web and the phone check out at once with different idempotency keys: the second waits for the cart lock, then finds the lines gone.
- `POST /v1/checkout/preview` runs the same validation and calculation without writing, so a client can show the totals before the buyer confirms.
- **Email must be verified** (403 `EMAIL_UNVERIFIED`): an unverified account may belong to someone who does not own the address (`apps/api/SECURITY.md`).
- At most 5 orders per buyer may wait for payment at once (409 `TOO_MANY_PENDING_ORDERS`), so one account cannot hold the stock of a whole product by never paying (OWASP API6).
- **Per-buyer rate limits.** Preview, shipping quotes and checkout each allow `APP_CHECKOUT_LIMIT_PER_MINUTE` requests per buyer per minute (30 by default; 429 `RATE_LIMITED`). Every preview and quote may call the courier API, and the preview tells which voucher codes exist, so without a limit one account could flood Biteship through GoShop or enumerate codes. Artikel 08 adds these limits to all three routes at once, closing the gap the preview (artikel 04) and the quotes (artikel 06) leave open until then. A promo that has not started yet answers like an unknown code (`reason: not_found`), so upcoming codes cannot be found by trying.
- **One clock per order row.** Every time on an `orders` or `order_items` row (`created_at`, `updated_at`, `payment_expires_at`, `paid_at`, `shipped_at`, `completed_at`, `cancelled_at`) comes from the API's clock (`@now`), never from the database's `now()`, so a row never mixes two clocks and a test's clock moves all of them. Rows of other tables written in the same transactions (variants, vouchers, carts, the outbox's own `created_at`) keep the database clock: they are not order data.

### Order lines are snapshots

`order_items` copies the product name, variant name, SKU and unit price, and `orders` copies the shipping address and the voucher code. A later rename, price change, archived variant or edited address never changes a past order. `variant_id` stays (RESTRICT) for stock restore and reporting.

### Statuses

`pending_payment → paid → processing → shipped → completed`, and `cancelled` from `pending_payment`, `paid` or `processing` (never after shipping). The allowed moves are one table in Go (`order.CanTransition`), so the service answers a clear 409 `INVALID_TRANSITION`; and each move is one SQL statement, `UPDATE orders … WHERE id = $1 AND status = ANY($from)`, so two racing requests cannot both move an order. Zero rows means someone else moved it first.

- Who moves what: the payment webhook (Bab 6) marks `paid`; a seller or admin moves `paid → processing → shipped → completed` and may cancel before shipping; a buyer may cancel an unpaid order and confirm receipt of a shipped one.
- **Cancelling restores stock** in the same transaction as the status change, and only when the guarded `UPDATE` returned a row, so a retried cancel or an expiry racing a cancel restores nothing twice. It also gives the voucher use back.
- **Deleting an account** (`DELETE /v1/me`, Bab 4) cancels the buyer's unpaid orders in the same transaction (`buyer_cancelled`, stock and voucher uses back, an event each) and deletes their cart and idempotency keys. Paid orders stay: they are financial records and wait for the seller. The stock and voucher uses of all those orders go back in **one aggregated statement each** (a sum per variant, a count per voucher), never order by order: see "Lock order" for why.
- A cart write or a checkout already in flight when the deletion commits cannot bring the account back: creating a cart and claiming an idempotency key both read the `users` row `FOR KEY SHARE` and require `anonymized_at IS NULL`, so they wait for a deletion in progress and then find the account gone (401).
- **Expiry**: an unpaid order is cancelled with `payment_expired` once `payment_expires_at` (`created_at + APP_PAYMENT_TTL`, 24 hours by default) has passed. `order.Service.ExpireDue` does it in batches, and `api expire-orders` runs it once and exits. Bab 5 has no worker yet: locally it is `make expire-orders`, in production a scheduled run of the same command; Bab 6's worker calls `ExpireDue` on a ticker. The guarded `UPDATE` re-checks the deadline, so an order paid at the last second is not cancelled.

### Stock: row locks for checkout, optimistic locking for the admin

- **Checkout and cancel use pessimistic row locks.** The checkout transaction locks the buyer's row (`FOR NO KEY UPDATE`, ADR 0005's users-first order), then the buyer's cart, then the variants with `SELECT … ORDER BY id FOR NO KEY UPDATE`, then decrements each with a guarded `UPDATE … WHERE stock >= $qty`. The one that comes second waits a few milliseconds and then sees the true stock. Restoring stock on cancel locks the order's variants in id order too. A short wait is right here: the buyer is ready to pay, and retrying a lost optimistic race would make them wait longer.
- **`FOR NO KEY UPDATE`, not `FOR UPDATE`.** Both stop another checkout from changing the row, but `FOR UPDATE` also blocks the `FOR KEY SHARE` lock that every new `cart_items` or `order_items` row takes on its variant (the foreign key check), so other buyers adding the same variant to their carts would wait for this checkout. Nothing here changes a variant's id, so the weaker lock is enough.
- **Admin edits use optimistic locking.** A seller's form can stay open for minutes. The admin `GET` returns each variant's `version`, the `PUT` sends it back, and `UPDATE … WHERE id = $1 AND version = $2` changes nothing when a checkout (or another admin) changed the variant in between: 409 `VERSION_CONFLICT`, reload and save again. Holding a row lock while a human edits is impossible over HTTP, and without the check the seller's stale form would overwrite the stock that buyers just took.
- **The product has a version of its own (Bab 12).** The variants' versions do not cover the product's fields (name, slug, description, status, category) or its set of variants: a stale form whose variants were untouched could overwrite another admin's name, and archive (`ArchiveVariantsNotIn`) a variant another admin added after the form loaded, with no conflict at all. `products.version` closes both: `PUT` must send it, the save compares it under the product's row lock before writing anything (409 `VERSION_CONFLICT` with `details.product_id`), and every save and every archive bumps it. Stock does not: checkouts, cancels, expiry and the stock adjustment endpoint bump the variant's version only, which is where an admin form that would write that stock finds out.
- **The admin save still takes row locks while it runs**, and in the same order: the product row, then every variant of the product in id order (`LockProductVariants`), before it writes them in the form's order. Without that step a save that writes the variants cheapest first, while a checkout or a cancel locks them in id order, is two transactions taking the same rows in opposite orders: a deadlock (40P01), which the database audit reproduced 3 times in 300 runs.
- Every change to `stock` bumps `version`, so both strategies see each other's writes. The `stock >= 0` CHECK is the last line of defence.

### Lock order

Every transaction that takes more than one of these locks takes them in this order, which is what makes them deadlock-free:

| Path | Order |
|---|---|
| checkout | buyer's `users` row → buyer's cart → variants (id order) → voucher → new rows (order, lines, outbox event) → idempotency key |
| cancel, expiry | the order (its guarded `UPDATE`) → its variants (id order) → voucher → outbox event |
| account deletion | `users` row → the buyer's unpaid orders (id order) → all their variants (id order, one statement) → their vouchers (id order, one statement) → one aggregated stock restore, one aggregated voucher release → the order cancels and events → cart → idempotency keys |
| admin product save | product → its variants (id order, `FOR UPDATE`: a SKU change updates a key column) → the writes |
| cart write, merge | `users` row (`FOR KEY SHARE`, the account must exist) → the user's cart → the guest cart (merge only) → each new line's variant (`FOR KEY SHARE`, the foreign key check), in `variant_id` order for a merge |

`FOR KEY SHARE` on `users` does not conflict with checkout's `FOR NO KEY UPDATE`, and checkout never locks a cart after a variant, so a cart write and a checkout cannot wait on each other in a circle. A merge writes its lines in `variant_id` order because each new line takes `FOR KEY SHARE` on its variant, and an admin save that changes SKUs holds those variants `FOR UPDATE` in id order: lines written in any other order would deadlock with it.

**Writing one row twice in a transaction locks its parent.** PostgreSQL skips the foreign key check on an `UPDATE` that leaves the key unchanged, except when the row was already written by the same transaction: then it checks again, and takes `FOR KEY SHARE` on the parent row. Restoring the stock of two orders one at a time updates a shared variant twice, so the second update locks the variant's product, and deadlocks with an admin save that holds that product and waits for the variant (the database audit saw about 180 such deadlocks in 30 seconds). That is why every restore or release that spans several orders is one aggregated `UPDATE`, which writes each row once. A single order touches each variant once (one line per variant) and has at most one voucher, so cancel and expiry release per order safely.

### Vouchers

`vouchers` holds a code, `percent` (1–100) or `fixed` (rupiah) value, minimum spend, optional maximum discount, a validity window, an optional total usage limit with `used_count`, and a per-user limit. Using one is race-safe in two ways: the total count is one guarded `UPDATE vouchers SET used_count = used_count + 1 WHERE … used_count < usage_limit AND now() in the window`, and the per-user count is read while the buyer's row is locked, so the same buyer's parallel checkouts take turns. A cancelled order gives its use back. Vouchers are created by `make seed` until the admin dashboard (Bab 12).

### Shipping

The API depends on a `shipping.Provider` interface (`Quote(ctx, Request) ([]Quote, error)`) for JNE, J&T and SiCepat. Two implementations:

- `static`: a fixed table per courier service and kilogram, deterministic, no network. Used in development and tests, and whenever `BITESHIP_API_KEY` is empty.
- `biteship`: Biteship's rates API (`POST /v1/rates/couriers`), chosen over RajaOngkir because it prices by **postal code**, which every GoShop address has, while RajaOngkir needs its own city IDs. It goes through sdk `httpx` with a timeout (`APP_SHIPPING_TIMEOUT`, 5s by default), never retries the POST, and maps the response to `shipping.Quote`.

Checkout always asks the provider again and takes the fee of the chosen service from that answer; a fee from the client is never trusted. The call happens **before** the transaction, so a slow courier API never holds a row lock.

- **A provider that does not answer** (a timeout, a transport error, 401/403/429 or 5xx from Biteship, or the circuit breaker open after repeated failures) is **503 `UPSTREAM_UNAVAILABLE`**: retry shortly.
- **A provider that answers and refuses the parcel** (Biteship 400/404/422: no courier serves the destination's postal code) is **422 `SHIPPING_UNAVAILABLE`**: retrying does not help, another address might. At checkout this failure frees the idempotency key, like every failed checkout. Biteship's 4xx answers are logged at WARN with the status and Biteship's error code only, because a 400 can also mean GoShop's own request is wrong (a bad `APP_SHIPPING_ORIGIN_POSTAL_CODE`), which an operator must notice.
- **The call does not end with the buyer's request** (`context.WithoutCancel`). sdk `httpx` counts every transport error, a cancelled context included, as a circuit-breaker failure, and five in a row open the breaker for every buyer for 30 seconds; five buyers hanging up at once would otherwise take shipping down for everyone. `APP_SHIPPING_TIMEOUT`, httpx's own timeout, still bounds the call.

### Idempotency

`POST /v1/checkout` requires `Idempotency-Key` (1–255 printable ASCII characters; a UUID is recommended). The key is stored per user with the SHA-256 of the request body (re-encoded, so whitespace does not matter) in `idempotency_keys`:

- A key is claimed with one `INSERT … ON CONFLICT` before the checkout runs. Every claim writes a new `claim_id`, and storing the answer or releasing the key matches that `claim_id`, so a request that was taken over as stale can neither save its answer into, nor delete, the claim of the request that took over.
- The checkout's own transaction stores the 201 response in the key's row, so the order and the stored response commit together.
- **A replay** of a finished key returns the stored response (same status and body) with `Idempotency-Replayed: true`.
- **The same key with a different body** is **422 `IDEMPOTENCY_KEY_REUSED`**: the request is well-formed, but it cannot be processed under that key (the IETF `Idempotency-Key` draft's choice). 409 is kept for "try again later".
- **A duplicate while the first is still running** is **409 `IDEMPOTENCY_IN_PROGRESS`**; the client retries after a moment.
- **A failed checkout releases its key** (the row is deleted), so the buyer can fix the cart and retry with the same key. Only success is remembered.
- A key whose request never finished (the process died) can be claimed again after 2 minutes, longer than any request may run.
- Keys live 24 hours; `api cleanup-idempotency-keys` deletes expired ones (Bab 6's worker runs it on a ticker). Its `DELETE` re-checks `expires_at`, so a key that a new claim took over while the cleanup waited for it is not deleted.

### Domain events: a transactional outbox

Every status change (`order.created`, `order.paid`, `order.processing`, `order.shipped`, `order.completed`, `order.cancelled`) inserts a row into `outbox_events` **in the same transaction** as the change. Publishing after the commit could lose the event when the process dies in between; publishing before the commit could announce an order that was rolled back. The outbox makes the event exactly as durable as the change.

A dispatcher reads unpublished rows in order with `FOR UPDATE SKIP LOCKED` (so two dispatchers never take the same row), hands each to a `Publisher`, and marks it published. In Bab 5 the publisher writes the event to the log (`api publish-events`, run once); Bab 6 replaces it with the job queue that sends emails and notifications. Delivery is at least once: a consumer must tolerate seeing an event twice (each has a unique `id`).

The dispatcher holds its batch's row locks while it publishes. With the log publisher that takes microseconds; Bab 6's queue publisher must bound it (a short timeout per publish, and a small batch), because a slow broker would otherwise keep a transaction open, and its locks held, for as long as the broker hangs.

## Alternatives considered

- **Carts in Redis** — fast and with TTLs built in, but checkout needs the cart and the stock in one consistent read, and Redis is configured as a cache that may evict keys. A cart is small; PostgreSQL handles it.
- **Carts only on the client** — no guest token, but the cart would not follow the buyer from the phone to the browser, and the server could not validate it before checkout.
- **A cookie for the guest cart** — natural in a browser, but the app would manage it by hand, and a cookie-authenticated write needs CSRF protection.
- **Merging inside login** — one call less, but four login paths would each need the cart, and auth would depend on the shop.
- **Optimistic locking at checkout** (retry on a version conflict) — no waiting, but under load on one popular item most attempts would fail and retry, which is slower and less fair than a short queue on a row lock.
- **`SERIALIZABLE` transactions** — correct without thinking about locks, but every conflict is a retry the code must handle, and the lock order would still matter for performance. Explicit locks are easier to read and to teach.
- **Publishing events directly to a queue after commit** — simpler, but loses events on a crash between the commit and the publish.
- **Storing every checkout response, failures included** — a retry after fixing the cart would then need a new key; releasing the key on failure is friendlier and safe, because a failed checkout changed nothing.
- **A real worker process now** — Bab 6 builds the worker with its queue; a one-shot command keeps Bab 5 runnable today without inventing the worker's design early.
- **Inserting the order lines in one statement** (`INSERT … SELECT FROM unnest(…)`, and one guarded `UPDATE … FROM unnest(…)` for the stock) — fewer round trips for a big cart, but harder to read and to explain which line failed. A cart has at most 50 lines, so checkout runs one `INSERT` and one guarded `UPDATE` per line. It is a known trade-off to revisit if the k6 numbers (artikel 14) show it matters.

## Consequences

- Checkout is one transaction of a few dozen statements; under a burst on one item, buyers queue on that variant's row lock. The k6 test in artikel 14 measures it.
- A seller editing stock sees 409 `VERSION_CONFLICT` when a sale happened while the form was open, and must reload. That is the point.
- The admin `PUT` body now needs each existing variant's `version`.
- Clients must send `X-Cart-Token` for a guest cart, call `/v1/cart/merge` after login, and send a fresh `Idempotency-Key` per checkout attempt (and the same key for its retries).
- Without a scheduled `api expire-orders`, unpaid orders keep their stock past the deadline; Railway needs a cron service for it until Bab 6. The same goes for `api publish-events` and `api cleanup-idempotency-keys`.
- `outbox_events` grows with every order; published rows can be deleted by a periodic job once Bab 6 has consumers.
- The order lifecycle is fixed in CHECKs and in one Go table; a new status (for example `refunded` in Bab 6) is a migration plus one line in each.
