# Bab 5 — Keranjang, checkout & order

Branch: `bab-5` (from `bab-4` @ `0522443`; Bab 4 verified code `803bb53`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | migrations 000007–000011 (carts, vouchers, orders, idempotency keys, outbox); packages `cart`, `order`, `shipping`, `outbox` |
| 1 unit tests | test-engineer | pass | 95.4% total coverage (cart 100, order 99.0, outbox 100, shipping 97.3); more than 100 mutation checks across the rounds, all caught |
| 2 DB audit | database-auditor | pass | 3 rounds on a large dataset: 4 blocking findings (B1–B4, below) fixed, then 0 blocking |
| 3 integration | integration-engineer | pass | every route and job against real PostgreSQL and Redis; 13 races × 25 iterations judged on the final DB state; k6; 653 top-level tests, 0 skipped on `make test-integration`; `-race` clean |
| 4 quality review | quality-review | pass | 3 rounds: 2 blocking (B1, B2), then 1 blocking (R2-B1), fixed; re-review clean |

**Verified SHA:** `0ae3f110743d1fee71df7e063e60ab78a3d6c2e0` (2026-10-24)

Every commit in `bab-4..bab-5` passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...` at its own snapshot (61/61).

k6 (12 VUs for 30 s plus a scarce scenario): checkout p95 about 57 ms at about 790 req/s, 0% unexpected responses, exactly 10 orders for 10 scarce units, no negative stock (`e2e/k6/README.md`).

### What the gate changed

- **DB audit B1:** two checkouts of one cart with different Idempotency-Keys created two orders. `Place` now locks the buyer's cart and re-reads its lines inside the transaction; a changed cart is 409 `CART_CHANGED`.
- **DB audit B2:** an admin product save deadlocked with checkout, cancel and expiry, because it updated variants in form order. It now locks every variant of the product in id order right after the product.
- **DB audit B3/B4:** deleting an account with unpaid orders deadlocked against an admin save (a variant written twice in one transaction re-runs its FK check and locks the product), and two deletions deadlocked on vouchers. The deletion now locks orders, variants and vouchers in id order and restores stock and voucher uses with one aggregated statement each.
- **DB audit advice:**
  - a partial index for unpaid orders (48 ms → 0.11 ms for a 20k-order buyer);
  - `FOR NO KEY UPDATE` on variants, so a checkout does not block other buyers' add-to-cart;
  - a `claim_id` on idempotency keys;
  - a re-check in the key cleanup;
  - a merge that writes in `variant_id` order;
  - no cart or key re-created for an account deleted mid-request.
- **Quality review B1:** a client hanging up counted as a Biteship failure, so five hang-ups opened the shared circuit breaker and stopped checkout for every buyer. Biteship is now called with `context.WithoutCancel`; `APP_SHIPPING_TIMEOUT` still bounds it.
- **Quality review B2:** preview, shipping quotes and checkout had no rate limit, which allowed voucher enumeration and upstream amplification. Per-buyer limits were added (`APP_CHECKOUT_LIMIT_PER_MINUTE`, default 30), and a voucher that has not started answers `not_found`.
- **Quality review R2-B1:** checkout's 422 can mean `IDEMPOTENCY_KEY_REUSED` or `SHIPPING_UNAVAILABLE`; the contract now lists both (`CheckoutUnprocessable`).
- **Smaller fixes:**
  - one clock for every order row;
  - a Biteship 4xx is 422 `SHIPPING_UNAVAILABLE` (logged at WARN with status and code only), not 503;
  - `CalculateTotals` runs once;
  - the load-test seed updates passwords on rerun;
  - `ClaimKey` no longer turns a database error into 409.

## Decisions

All recorded in ADR 0006, including the lock-order table.

- **Money** is whole rupiah through sdk `moneyx`. Order lines snapshot name, variant and price at checkout.
- **Guest cart:** an opaque token `<cart id>.<32 random bytes>` in the `X-Cart-Token` header (no cookie: the mobile app has no cookie jar, and a header needs no CSRF protection). Only its SHA-256 is stored. `POST /v1/cart/merge` after login never lowers the user's quantities.
- **Shipping:**
  - a `shipping.Provider` with a static per-kg table (used when `BITESHIP_API_KEY` is empty; WARN outside development) and a Biteship client (by postal code, sdk `httpx`, 1 MiB read limit, no retries);
  - the quote is taken before the transaction, and the fee always comes from the provider.
- **Overselling:**
  - checkout uses row locks in id order plus a guarded decrement (`stock >= qty`);
  - admin saves use optimistic locking (`version`, 409 `VERSION_CONFLICT`);
  - this closes the Bab 3 hard gate.
- **Idempotency:**
  - `Idempotency-Key` is required on checkout;
  - a replay is byte-identical, with `Idempotency-Replayed: true`;
  - the same key with another body is 422, a key still in flight is 409;
  - a failed checkout frees its key;
  - keys live 24 hours.
- **Order status:**
  - pending_payment → paid → processing → shipped → completed, or cancelled;
  - enforced in Go and in conditional SQL;
  - `api expire-orders` cancels unpaid orders after `APP_PAYMENT_TTL` and restores stock.
- **Events:** a transactional outbox (`outbox_events`), drained by `api publish-events` with `FOR UPDATE SKIP LOCKED` into a log publisher. Delivery is at least once. Bab 6 adds the real publisher and must bound publish time.
- **Checkout gates:**
  - `email_verified` (403 `EMAIL_UNVERIFIED`), from the Bab 4 `SECURITY.md`;
  - at most 5 unpaid orders per buyer.
- **Account deletion** now also cancels the buyer's unpaid orders, restores their stock and vouchers, and deletes their cart and idempotency keys.

## Notes

- **Bab 4 fixes delivered here:**
  - `0258acf`: an IPv4-mapped client counts as its IPv4 address;
  - `ddb02e3`: compose `migrate` env;
  - `cd3e4bf`: `Retry-After` capped at the end of the window, a ratelimitx gap recorded in `docs/sdk-gaps.md`.

  The Bab 4 articles describe `bab-4` as it was. The Bab 5 articles mention these changes where they matter, so no Bab 4 erratum is needed.
- **Rate limits:** the per-buyer limits arrive in artikel 08, which closes the gap left open by the preview (04) and quotes (06) routes.
- **Migrations 000009 and 000010** were edited in place during the gate, before release. A local volume migrated from an earlier build of this branch needs `docker compose down -v`.
- **Orchestrator authority:**
  - feat commits updated test-owned `*_test.go` files only with mechanical edits (usage strings, CORS lists, Retry-After), to keep every commit green;
  - test-engineer moved test fixes into the commits that needed them;
  - integration-engineer added the `loadtest` Makefile target.
- **Deliberate duplication:** `cart/token.go` copies the shape of `auth/opaque.go` rather than sharing it; artikel 03 says why.

## Deferred

- **Bab 6:**
  - the real outbox publisher with a bounded publish time;
  - deleting published outbox events;
  - a worker job that deletes abandoned guest carts;
  - `MarkPaid` from the payment webhook;
  - product images in the contract.
- **Load test:** run the k6 stack with `APP_CHECKOUT_LIMIT_PER_MINUTE=100000`; `e2e/k6/run.sh` refuses to run otherwise.

## Articles → code

Each article has a `feat` commit, unit tests and integration tests.

| Artikel | Topic | feat | tests (unit, integration) |
|---|---|---|---|
| 01 | Cart and order domain design: ADR 0006 | `bf9870d` (docs) | — |
| 02 | Cart API | `33e03ed` | `2fc0f32`, `a1a973d` |
| 03 | Guest cart vs user cart, merge | `efaefa7` | `14a07f1`, `14b0e43` |
| 04 | Stock validation at checkout | `c7e3b45` | `3934885`, `aa637cd` |
| 05 | Totals: price, discount, shipping | `828ee55` | `223c9a0`, `b50fdba` |
| 06 | Shipping (Biteship) at the API | `af00607` | `4b77ff1`, `5f20f0c`, `f79739e`, `c712480`, `0ae3f11` |
| 07 | Vouchers and promos | `168551c` | `8787dc6`, `209506c`, `08057b3`, `bf7ac5e` |
| 08 | Creating the order in one transaction | `a979942` | `3d42885`, `9835e60`, `d8947d1`, `9408b8b`, `b39e8ea` |
| 09 | Preventing overselling: row vs optimistic locking | `d586016` | `25eafa3`, `debacf6`, `b9b545d` |
| 10 | Order status state machine | `a530c8d` | `bc4c036`, `3b21b77`, `8541d0a`, `ff0502b` |
| 11 | Buyer order history | `5282c61` | `625f635`, `5bc4ea9` |
| 12 | Idempotency key for checkout | `34378b6` | `e29d200`, `53075fc`, `d7d404b` |
| 13 | Domain events: transactional outbox | `6a553ec` | `978b779`, `80b4ed9`, `e1f3f4f` |
| 14 | k6 load test of checkout | `8767ca5` (seed) | `0177532`, `d30aa1d` (k6), `3a56360` |
| 15 | Recap + challenge: wishlist | conceptual | — |
