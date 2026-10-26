# Bab 6 — Pembayaran, upload & notifikasi

Branch: `bab-6` (from `bab-5` @ `45aab80`; Bab 5 verified code `0ae3f11`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | migrations 000012–000020 (payments, payment events, reconciliation columns, product images and their variants, guest-cart and refresh-token indexes, event deliveries, a paid-at index); packages `payment` (with `midtrans` and `fake`), `storage`, `imaging`, `notify`, `worker`, `report`; a second binary `cmd/worker` with `Dockerfile.worker` |
| 1 unit tests | test-engineer | pass | 97.4% total coverage (payment 99.3, midtrans 98.4, fake 97.2, storage 98.3, imaging 96.0, notify 97.4, mail 95.7, worker 92.1, report 100); 48/48 mutations caught in the first round, 79/79 in the last; an AST check that the signature compare is constant-time; 1 production bug found and fixed (below) |
| 2 DB audit | database-auditor | pass | 5 rounds on a large dataset: 3 blocking findings (B1, B2 in round 1; B3 in round 2) fixed, then 0 blocking in rounds 3–5; 0 deadlocks in every round |
| 3 integration | integration-engineer | pass | every route and job against real PostgreSQL, Redis and SeaweedFS; 11 races × 25 iterations judged on the final DB state; checkout → fake pay → webhook → `order.paid` → email end to end through the worker program; 1054 top-level tests, 0 skipped on `make test-integration`; `-race` clean on the unit and integration suites (28 packages; the integration package takes about 19 minutes under `-race`, so it needs `-timeout 60m`) |
| 4 quality review | quality-review | pass | round 1: 0 blocking, 6 advice items (A1–A6); A1, A2, A4, A5, A6 fixed and A3 recorded here; round 2 re-review: pass, 0 blocking; round 3 (the artikel-05 timestamp fix, with a DB audit): pass, 0 blocking |

**Verified SHA:** `33c05d5391dc91e2dfd70cb53249a17a4d725e02` (2026-10-26). The gate first passed on `8b553dd48d213b8edde391afad8856a7939ec70e`; writing artikel 05 then found a bug (below), fixed in `8204de2` and `33c05d5`, and the whole gate ran again on the new SHA.

Every commit in `bab-5..bab-6` passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...` at its own snapshot (54/54; `4df9666` is docs only).

`make verify` ran from a cold stack (`docker compose down -v` first) at the verified SHA and passed every stage in 477 s (515 s at `8b553dd`), with 0 skipped tests; the integration suite then ran again under `-race` (about 19 minutes, `-timeout 60m`), clean.

### What the gate changed

- **Unit tests found a production bug:** with payments or storage turned off, the payment and image routes answered 500 `INTERNAL_ERROR`, not the 503 `PAYMENTS_DISABLED` / `STORAGE_DISABLED` that ADR 0007 and the contract promise, because `httpapi.ToAppError` turned every 5xx except `UPSTREAM_UNAVAILABLE` into an internal error. It now passes the 503s the API builds on purpose (`PAYMENTS_DISABLED`, `STORAGE_DISABLED`, `UPSTREAM_UNAVAILABLE`, `TIMEOUT`) through; any other 5xx is still 500. A feature turned off by configuration is logged at WARN, not ERROR.
- **DB audit B1:** migration 000016 added the "a ready image has variants" check constraint before the `UPDATE` that moves `ready` images to `processing`, so with one `ready` image in the table it failed and left the database dirty at version 16 (a reader migrating from artikel-05 to artikel-06). The `UPDATE` now runs between the column change and the constraint; up, down and up again are clean, and down returns `failed` images to `pending_upload`.
- **DB audit B2:** the guest-cart cleanup could delete lines that had just been added successfully (16 lost adds in the audit's probe). The guest-cart lock was `SELECT … FOR UPDATE`, which changes nothing, so PostgreSQL did not re-check the cleanup's `WHERE` after waiting for it. `LockGuestCart` is now `UPDATE … SET updated_at = now()`: 0 lost adds.
- **DB audit B3** (a regression from the round-1 fix that closes a cancelled order's open payment): payments GoShop closed on cancel were never reconciled, while Midtrans' Snap page still took money until `expires_at`. Money paid there with its notification lost went unrecorded (0/20 in the probe). The reconciler gained a second queue for closed payments with its own partial index: 20/20 recorded as `refund_required`, at 1.4–1.6 ms per query with a backlog of 64k cancelled payments.
- **DB audit advice, all applied:**
  - inserting a payment reads the order `FOR SHARE` in the same statement, and every path locks the order before its payments (300 races against cancel, expiry and account deletion: 0 open payments left on a closed order);
  - open payments are checked first, and a closed payment is re-checked at most every 30 minutes (a backlog of 2,000 closed payments had made open payments wait about 109 minutes instead of 9);
  - a closed payment leaves the queue only on a final answer from Midtrans (`final_checked_at`), not after a fixed time or a check that still says `pending`;
  - a final answer with a mismatched amount is not final, and closing a payment clears `final_checked_at` (the mismatched-amount probe went from 0/10 to 10/10 recovered);
  - the sales report got faster (850 → ~250 ms and 530 → ~150 ms);
  - the outbox dispatcher is bounded per batch, not only per publish;
  - resizing applies the photo's EXIF orientation;
  - originals moved under `uploads/`, private, with only `products/*` publicly readable;
  - migration 000018 builds its index without `CONCURRENTLY`, accepted by the auditor after the deadlock was reproduced (`9ded50b`);
  - the missing foreign keys were added to the ERD.
- **Quality review A1:** the reconcile loop never checked its context, so a run cut off by the 4-minute Asynq timeout kept calling Midtrans while the next run started. It now stops before the next payment and returns the partial result with the wrapped context error; unreached payments keep their place in the queue.
- **Quality review A2:** a `settlement` or `capture` for a payment that could not become paid (denied, failed, refunded) was recorded at DEBUG only. It is now a WARN with the payment's status, so an operator sees money with no order change.
- **Quality review A4:** the sales report's range error and contract said "at most 366 days later", but `to = from + 366 days` is refused. The text now reads "at most 366 days in all, both included".
- **Quality review A5:** `APP_PAYMENT_TTL` accepted `1m`, but a Snap transaction keeps a one-minute margin, so every pay call under about 2 minutes was 409 `PAYMENT_WINDOW_CLOSED`. The minimum is now `5m`.
- **Quality review A6:** the order-confirmation email, rendered when it is sent (possibly hours later, after retries), could still ask the buyer to pay an order that was already paid or cancelled. The "pay before" line now appears only while the order is `pending_payment`.
- **Found while writing artikel 05:** `POST /v1/admin/products/{id}/images/uploads` answered `created_at` and `updated_at` as `0001-01-01T00:00:00Z`, because `InsertProductImage` was `:exec` and `CreatePendingImage` never read back what PostgreSQL set. The insert now ends in `RETURNING created_at, updated_at` (`8204de2`), and the upload integration test checks both against the stored row (`33c05d5`). A DB audit and a review of the fix (round 3) passed with 0 blocking, and found no other insert with the same problem.
- **Integration:**
  - `TestResetPassword` (Bab 4) failed now and then because the host's clock and PostgreSQL's `now()` in the Docker VM disagree by a second or two; token expiries are compared within a 5-second margin (`a84c72a`);
  - `make test-integration` starts the `worker` service, so its health check gates the run (`e3e93f3`).
- **Smaller fixes:**
  - a task that skips its retries (`asynq.SkipRetry`) is logged as dead with the requeue command, not as retried (`f375cae`);
  - the local SeaweedFS key is accepted in any environment, because refusing it outside development stopped the in-process APIs the integration tests start with `APP_ENV=production` (`e01f487`); the JWT placeholder and the fake gateway are still refused;
  - the made-up Midtrans keys in the tests are short enough that `make scan` does not take them for real ones (`8b553dd`).

## Decisions

All recorded in ADR 0007, including the payment rows of the lock-order table.

- **Payments:**
  - Midtrans Snap, sandbox only: `SB-Mid-*` keys and `MIDTRANS_IS_PRODUCTION=false`, or the API does not start; an empty `MIDTRANS_SERVER_KEY` turns payments off (503 `PAYMENTS_DISABLED`);
  - `POST /v1/orders/{id}/pay` has no body; the amount is always the order's `total`;
  - one open payment per order (a partial unique index), reused on every pay call; each payment has its own Midtrans `order_id` (`<order code>-<6 characters>`), so a denied or cancelled payment does not end the order's chance to be paid;
  - the Snap transaction expires one minute before the order's deadline; fewer than two minutes left is 409 `PAYMENT_WINDOW_CLOSED`;
  - Midtrans is called outside any transaction, with `context.WithoutCancel` and `APP_PAYMENT_TIMEOUT` (the Bab 5 Biteship lesson).
- **Webhook:**
  - 64 KiB body limit and 120 calls per client IP per minute;
  - `signature_key` checked with `hashx.ConstantTimeEqual`, 403 `INVALID_SIGNATURE` otherwise;
  - the notification is only a hint: the status applied comes from Midtrans' status API, whose answer is signature-checked too;
  - the amount must match exactly, or nothing changes (`amount_mismatch`, ERROR);
  - every status acted on is recorded once in `payment_events`, so replays are no-ops;
  - payment statuses never move backwards; the order moves only through the ADR 0006 guarded transitions (`MarkPaidIn`).
- **Late money is never lost and never revives an order:** a settlement for a payment GoShop closed, or for an order that can no longer be paid, makes the payment `paid` with `refund_required_at`; the order stays as it is. Closing an order closes its open payment in the same transaction; GoShop does not call Midtrans' cancel API.
- **Reconciliation:** `api reconcile-payments`, and the worker every 5 minutes, ask the status API about two queues with separate budgets (100 open, 25 closed per run). A failed check changes nothing and keeps its place; capacity for closed payments is 300 checks an hour, above which checks are delayed, never dropped.
- **Images:**
  - a presigned `PUT` (15 minutes, `Content-Type` and `Content-Length` signed) for JPEG, PNG or WebP up to 5 MiB, at most 10 images per product;
  - confirm checks what arrived: stored size and type, the sniffed format, and at most 6000 px a side and 24 megapixels before anything decodes it;
  - the worker writes 400w and 800w JPEGs (quality 82, Catmull-Rom, EXIF orientation applied, metadata dropped) with pure-Go `golang.org/x/image`, so the image stays static and distroless; no WebP variants (no pure-Go encoder);
  - the storefront lists ready images only, with `variants` for `srcset`; the original is never linked;
  - S3 through `minio-go` behind sdk `storagex.Storage`; SeaweedFS locally.
- **Worker:** a separate binary on Asynq, on the Redis GoShop already runs. Every scheduled job moved there as a unique task (outbox 5 s, expiry 1 min, reconcile 5 min, images 30 s, key/token/guest-cart cleanups hourly, outbox cleanup daily). The `api …` one-shot commands stay for operators.
- **Retries and the dead-letter queue:** limits per type (emails 8, Telegram 5, jobs 3), exponential backoff from 10 s capped at 1 hour with jitter; a task out of retries is archived and handled with `worker dead-tasks list|requeue|requeue-all`, which never prints payloads.
- **Outbox:** `notify.QueuePublisher` makes one task per consumer per event, with Asynq task ID `<event id>:<consumer>` and an `event_deliveries` record per consumer, so delivery is at least once and consumers are idempotent. Each publish gets 2 s, a batch 5 s, a run at most 10 batches. Production Redis must not evict and should persist.
- **Email and Telegram:** SMTP when `SMTP_HOST` is set (STARTTLS required except to localhost, CR/LF refused in headers), otherwise the Bab 4 log mailer; with SMTP on, the API's own emails are queued for the worker. The seller's Telegram message uses sdk `messagingx`, with the URL (and the bot token in it) stripped from every error.
- **Mock gateway:** `APP_PAYMENT_PROVIDER=fake` keeps transactions in Redis and `api fake-pay` sends a signed notification; the API and the worker refuse it in production.
- **Sales report:** `GET /v1/admin/reports/sales` (staff only) with a CTE, `generate_series` and a running total by window function, in Jakarta days, served by a partial index on `orders (paid_at)`.
- **Refunds** are the chapter's challenge; the schema already has `refunded_amount`, the refunded statuses and `refund_required_at`.
- **New dependencies:** `github.com/hibiken/asynq`, `github.com/minio/minio-go/v7`, `golang.org/x/image`. sdk stays at v0.2.0; the new gaps (S3, job queue, payment gateway, image resizing, chat notifications, email) are in `docs/sdk-gaps.md`.

## Notes

- **Bab 5 deferrals delivered here:**
  - the real outbox publisher with a bounded publish time: `36883d6` (artikel-11, `outbox.PublishTimeout`, `notify.QueuePublisher`);
  - deleting published outbox events: `36883d6` (`outbox.Cleanup`, daily after 7 days, with their delivery records);
  - the abandoned guest-cart cleanup: `9a1554a` (artikel-07, hourly, carts untouched for 30 days), made safe by DB audit B2;
  - `MarkPaid` from the payment webhook: `2a0eae0` (artikel-03, `order.MarkPaidIn` inside `payment.Service.Apply`);
  - product images in the contract: `74043d2` (artikel-05, `ProductImage`) and `068ae59` (artikel-06, `variants`).

  The refresh-token cleanup left open by ADR 0005 arrives in `9a1554a` as well.
- **Bab 5 fix delivered here:** `118fdc0`: `docs/configuration.md` gives the k6 limit as `APP_CHECKOUT_LIMIT_PER_MINUTE=100000`, as `e2e/k6/run.sh` requires, not "about 1 500". The Bab 5 articles quote the k6 README, so no erratum is needed.
- **Migrations 000014, 000016 and 000018** were edited in place during the gate, before release (B3's index and `final_checked_at` in 000014, B1's order in 000016, `9ded50b` in 000018). A local volume migrated from an earlier build of this branch needs `docker compose down -v`.
- **Cross-article commits:** `e9317fd` updates `docs/architecture.md`, `docs/erd.md`, `apps/api/SECURITY.md`, `docs/sdk-gaps.md` and the API README; `a84c72a` is the clock-skew fix; `e484289` makes the integration tests pass golangci-lint.
- **Midtrans sandbox:** no real sandbox key was available during the gate. Every payment test runs against `payment/fake` or an `httptest` Midtrans; the articles say so where they show a payment.
- **Review notes, no action:**
  - A1: a deadline that passes during a gateway call also fails that payment's `Apply` in PostgreSQL, so it counts as failed and is asked again next run; the unit fake ignores the context, so its counts differ by one from production;
  - A2: the WARN reads the payment's status from before the transaction, so two paid events at the same moment could log a spurious WARN; harmless.
- **Known limit:** a closed payment whose check fails for good holds one of the 25 closed slots in every run until an operator acts on its WARN line (ADR 0007); skipping it would be the one way to leave the queue without a final answer.
- **Orchestrator authority:**
  - `2a0eae0` feat(bab-6/artikel-03) added new assertions to test-owned `internal/order/account_test.go` and `transition_test.go` (closing open payments on cancel and account deletion), not only mechanical edits;
  - `302c5c1` feat(bab-6/artikel-02) rewrites test-owned `apps/api/internal/config/shipping_test.go` (`TestLoad_PaymentTTL` as a table, +32/−8), because the A5 minimum would otherwise leave the intermediate commits red;
  - `e3e93f3` test(bab-6/artikel-07) changed the backend-owned `Makefile`, adding `worker` to `make test-integration`;
  - `302c5c1`, `ed4ea6e`, `068ae59`, `8ac3c30`, `36883d6` and `f6d3dd0` made mechanical test edits (usage strings, a call signature, a log message, the rate-limit count), to keep every commit green;
  - `8204de2` fix(bab-6/artikel-05) also updates test-owned `internal/product/image_repository_test.go`, `image_service_test.go` and `image_handler_test.go`, so the fix commit stays green;
  - none of these lets a test agent change production code.

## Deferred

- **Partial refunds:** the chapter's challenge (artikel 15). A `refunds` table and the Midtrans refund API call; nothing existing changes shape.
- **Real Midtrans sandbox:** run pay → Snap → notification once with sandbox keys before the series goes live.
- **WhatsApp** for the seller waits for an sdk provider (`docs/sdk-gaps.md`).
- **Bab 7–9 (web):** rebase onto `bab-6` and regenerate the types from this contract (product images with `variants`).
- **Bab 19 (deployment):**
  - production Redis with `maxmemory-policy noeviction` and persistence, the boundary of "never lost" for side effects;
  - build the refresh-token index by hand first on a big table (migration 000018 says how);
  - a bucket policy, CDN or R2 domain that makes only `products/` public.

## Articles → code

Each article has a `feat` commit, unit tests and integration tests.

| Artikel | Topic | feat | tests (unit, integration) |
|---|---|---|---|
| 01 | Online payment flow and payment-gateway concepts: ADR 0007 | `98584a6` (docs) | — |
| 02 | Midtrans Snap integration (sandbox) | `302c5c1` | `441a35e`, `13db86d` |
| 03 | Payment webhook and signature verification | `2a0eae0`, `9895fed` | `1d223ab`, `198227b`, `b1c8577`, `9b6d3b5`, `8b553dd` |
| 04 | Payment status reconciliation | `ed4ea6e` | `6d7e0ac`, `1a4be2a` |
| 05 | Product image upload to S3/R2 with presigned URLs | `74043d2`, `e01f487` (fix), `8204de2` (fix) | `ada0368`, `7c22ce3`, `4f58144`, `33c05d5` |
| 06 | Image resize and optimisation | `068ae59` | `0549e3c`, `149ea39` |
| 07 | Background jobs with a worker and queue (Asynq) | `9a1554a`, `9ded50b` (fix) | `4b00b84`, `5d273dd`, `b95ad19`, `413d76c` (end to end), `e3e93f3` |
| 08 | Transactional email | `8ac3c30` | `8e22beb`, `cce3c50` |
| 09 | WhatsApp/Telegram notification to the seller | `fe7f551` | `6a13c52`, `2ffc09a` |
| 10 | Retry and dead letter queue | `b267f71`, `f375cae` (fix) | `1d37be7`, `b1a4c0e` |
| 11 | Outbox pattern so events are not lost | `36883d6` | `e559b78`, `87b27da` |
| 12 | Simple sales report via SQL | `49845be` | `8309127`, `fde3b84` |
| 13 | Mock payment gateway for testing | `f6d3dd0` | `92c28ef`, `0fd4749` |
| 14 | Auditing the API with AI: security and error handling | conceptual: this chapter's stage 4 review (A1–A6) and DB audit (B1–B3) | — |
| 15 | Recap + challenge: partial refund | conceptual | — |

Cross-article: `118fdc0` (Bab 5 doc fix), `e9317fd` (docs), `a84c72a` (clock skew), `e484289` (lint).
