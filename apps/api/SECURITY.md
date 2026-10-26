# GoShop API and the OWASP API Security Top 10 (2023)

What the API does about each risk of the [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/), where in the code it happens, and what is still open. Updated with every chapter that changes the answer; this version is Bab 6 (payments, uploads, the worker and notifications).

| # | Risk | Status |
|---|---|---|
| API1 | Broken object level authorization | covered for every user-owned object so far |
| API2 | Broken authentication | covered; known limits below |
| API3 | Broken object property level authorization | covered |
| API4 | Unrestricted resource consumption | covered for Bab 4; known limits below |
| API5 | Broken function level authorization | covered |
| API6 | Unrestricted access to sensitive business flows | covered for sign-up, login, reset, guest carts, checkout and payment |
| API7 | Server side request forgery | not exposed: outbound calls go to fixed hosts only |
| API8 | Security misconfiguration | covered |
| API9 | Improper inventory management | covered |
| API10 | Unsafe consumption of APIs | covered for Google, Biteship, Midtrans, S3 uploads and Telegram |

## API1: Broken object level authorization (BOLA)

- **The owner comes from the token, never from the request.** `/v1/me/...` routes have no user ID in the URL or body; handlers read the caller's ID that `auth.Guard` put in the context (`ctxx.UserID`).
- **Every query is scoped by owner.** Each address query takes `id` *and* `user_id` (`internal/db/queries/addresses.sql`), so another user's address is simply not found. The same holds for orders (`GetOrderForUser`), the cart (found by the caller's `user_id`, or by a guest token whose secret is checked in constant time), and checkout's `address_id`.
- **404, not 403.** Someone else's address answers exactly like a missing one (and a non-UUID id is 404 before any query), so a caller cannot even learn that the ID exists.
- Admin product routes are deliberately not owner-scoped: GoShop is one store, and every seller manages the whole catalog (`docs/prd.md`).

## API2: Broken authentication

- **Passwords**: argon2id via sdk `hashx` (m = 64 MiB, t = 3, p = 4, 16-byte salt, 32-byte key, parameters encoded in each hash). Policy after NIST SP 800-63B: 8–128 characters, not a common leaked password, no composition rules (`auth.CheckPassword`). Passwords are never logged, returned or stored in plain text.
- **No user enumeration on login**: every failure is the same 401 `INVALID_CREDENTIALS`, and an unknown email or a passwordless account is verified against a dummy hash made at start, so each path costs one argon2id verification (`auth.Argon2Hasher.Verify`, `Service.Login`).
- **No enumeration on forgot-password**: always 202; a sending failure is logged, not returned.
- **Tokens** (ADR 0005): 15-minute HS256 access tokens (sdk `jwtx`, `alg=none` refused, algorithm pinned by the key) with issuer, audience, `exp`, `sid` and role checked by `AccessTokens.Check`; opaque refresh and email tokens of 256 random bits, stored only as SHA-256, compared in constant time (`hashx.ConstantTimeEqual`), single use under a row lock; refresh rotation with reuse detection that revokes the whole session.
- **Revocation**: logout, refresh-token reuse, password reset and account deletion end the session's refresh tokens (PostgreSQL) and access tokens (Redis marker checked on every request, fail closed).
- **Brute force**: per-IP rate limits on login, register, forgot-password, Google sign-in, refresh, verify-email and reset, plus per-email limits on login and forgot-password only, and a per-account limit on resending the verification email (`auth.Limit*`, 429 with `Retry-After`).
- **Secrets**: `JWT_SECRET` must be 32+ bytes and the `.env.example` placeholder is refused outside development.
- **Google**: ID tokens are verified for signature (Google's JWKS), issuer, audience (our client ID) and expiry; accounts link by Google's `sub`, never by email, and an email that already has an account is not linked.

Known limits:

- Registration answers 409 `EMAIL_TAKEN` for a registered email: a clear sign-up form was chosen over hiding it; the endpoint is rate limited per IP.
- Forgot-password does a little more work when the account exists, which a careful timing measurement could see. With `SMTP_HOST` set (Bab 6) the email is only queued for the worker, so the difference is one Redis write; with the log mailer (no SMTP) it is one log line.
- The per-email login limit lets an attacker lock a victim out of password login for up to 15 minutes; Google sign-in and the reset email still work.
- Deleting the account and resetting the password need no re-authentication beyond a valid access token (resetting needs the emailed token). A step-up check (password or a fresh Google token) is a later hardening.
- No second factor yet (the chapter's challenge: login with OTP).
- **Pre-registration squatting**: anyone can register an address they do not own; the account stays unverified. The real owner's first Google sign-in with that address then answers 409 `EMAIL_TAKEN`, because accounts are never linked by email. The owner gets the account back with forgot-password (the reset proves the address, marks it verified and ends the squatter's sessions) and signs in with the password from then on; linking Google to an existing account is a later feature. Checkout is gated on a verified email (403 `EMAIL_UNVERIFIED`, checked under the buyer's row lock in the checkout transaction, Bab 5), so an unverified squatter account cannot place an order.
- **Shared addresses (CGNAT)**: the per-IP limits count everyone behind one address together. Mobile carriers in Indonesia put many customers behind carrier-grade NAT, so on a busy network the login, register or forgot-password limit can be reached by strangers, and a user then waits for `Retry-After`. The per-email limits and higher per-IP limits keep that rare; an IPv6 client is counted by its /64, which is one customer, not one carrier.

## API3: Broken object property level authorization

- **Every request body is an explicit struct, and unknown fields are refused** (`httpapi.DecodeJSON` with `DisallowUnknownFields`). There is no way to send `role`, `email_verified`, `user_id` or `password_hash`: the bodies have no such fields, so mass assignment cannot happen.
- **Every response is an explicit JSON struct** (`user.JSON`, `address.addressJSON`, …), built field by field. The password hash, token hashes, `anonymized_at` and internal versions never leave the server.
- `PATCH /v1/me` changes only name and phone; the email cannot change until re-verification exists.

## API4: Unrestricted resource consumption

- Request bodies are capped at 1 MiB (`httpapi.MaxBodyBytes`), headers at 1 MiB, and every request has a deadline (`APP_REQUEST_TIMEOUT`); the `http.Server` has read, write and idle timeouts.
- Lists are bounded: catalog pages at most 100, at most 20 addresses per user (409 `ADDRESS_LIMIT_REACHED`), at most 50 variants per product.
- At most four argon2id hashes run at once per instance (`DefaultMaxConcurrentHashes`, 256 MiB worst case); the others wait or give up with their request.
- Rate limits (above) bound login, register, the email-sending endpoints and the token endpoints, which each cost a query and, for a reset, a hash.
- **Shop bounds (Bab 5):** a cart holds at most 50 lines of at most 99 units each; a buyer may hold at most 5 unpaid orders; new guest carts are limited to 30 per client IP per hour; the courier rates API's answer is read through a 1 MiB limit, within `APP_SHIPPING_TIMEOUT`, and never retried.
- **Per-buyer limits on checkout:** `POST /v1/checkout/preview`, `GET /v1/checkout/shipping-quotes` and `POST /v1/checkout` each allow `APP_CHECKOUT_LIMIT_PER_MINUTE` requests per buyer per minute (30 by default; 429 `RATE_LIMITED` with `Retry-After`). Every preview and quote can call the courier rates API, so without the limit one account could use GoShop to flood it.
- **Growth is bounded by the worker (Bab 6):** expired refresh tokens and idempotency keys are deleted hourly, guest carts untouched for 30 days hourly, uploads never confirmed after a day, published outbox events and their delivery records after 7 days.
- **Uploads never pass through the API.** A seller gets a 15-minute presigned `PUT` for exactly one declared type (JPEG, PNG, WebP) and size (at most 5 MiB), with `Content-Type` and `Content-Length` signed; a product holds at most 10 photos, pending ones included. Confirm reads only the file's header, and refuses a bitmap over 6000 px a side or 24 megapixels before anything decodes it (a decompression bomb); the worker resizes one image at a time.
- **Payments:** `POST /v1/orders/{id}/pay` allows 10 calls per buyer per minute (each may call Midtrans), and the public notification route 120 per client IP per minute with a 64 KiB body.

## API5: Broken function level authorization

- Admin routes are mounted behind `auth.Guard.Authenticate` and `auth.RequireRole(seller, admin)` in one place (`internal/app/app.go`), so a new admin route cannot be added without them.
- `RequireRole` without claims answers 401, so a route mounted in the wrong group fails closed.
- The API cannot create an admin; `make seed-admin` does it locally only.
- Order status changes are split by role: `/v1/admin/orders/…` (seller or admin) move any order through processing and shipping; a buyer's `/v1/orders/{id}/cancel` and `/complete` are scoped by `user_id` in the SQL and allow only the buyer's moves (cancel while unpaid, confirm receipt). Marking an order paid has no route a person can call: only a Midtrans notification whose signature checks, and whose status Midtrans' own status API confirms, moves an order to `paid` (Bab 6). The sales report is staff-only.

## API6: Unrestricted access to sensitive business flows

- Sign-up, login and password reset are rate limited and send email only to the address's owner.
- **Account deletion releases stock**: deleting an account cancels its unpaid orders in the same transaction (stock and voucher uses back) and deletes its cart, so a deleted account cannot keep stock reserved until the payment deadline (Bab 5; paid orders stay for the seller).
- **Stock hoarding**: checkout takes stock while an order waits for payment, so a buyer may have at most 5 unpaid orders (409 `TOO_MANY_PENDING_ORDERS`, counted under the buyer's row lock), every line is capped at 99 units and the stock on hand, and an unpaid order gives its stock back at `payment_expires_at` (`APP_PAYMENT_TTL`).
- **Guest carts** are created at most 30 times per hour per client IP (`cart.LimitGuestCartPerIP`); a cart holds at most 50 lines.
- **Voucher codes cannot be enumerated**: the preview and checkout answer a code that does not exist and a promo that has not started yet alike (`reason: not_found`), and the per-buyer limit above bounds how many codes one account can try.
- **Prices and fees come from the server**: checkout reads the lines from the server-side cart, re-reads prices on locked rows, refuses a line whose price changed since the buyer saw it, and asks the shipping provider for the fee itself. A client cannot send a price, a fee or a discount.
- **Retries never double an order**: `POST /v1/checkout` requires an `Idempotency-Key`, stored per user with the hash of the body; the order and the stored answer commit in one transaction (ADR 0006).
- **Vouchers** count their uses with a guarded `UPDATE`, and the per-buyer limit under the buyer's row lock, so parallel checkouts cannot overuse one.
- **Payment amounts come from the server** (Bab 6): `POST /v1/orders/{id}/pay` has no body; the Snap transaction's amount is the order's `total` from its row, and the stored payment must match it. A notification whose amount is not the payment's changes nothing (`amount_mismatch`, logged at ERROR).
- **A payment cannot revive an order**: money for an order that expired, was cancelled or was paid by another payment is recorded and flagged for a refund (`refund_required_at`), never moves the order back to `paid`. Notifications never move a payment or an order backwards (guarded status changes, both directions in one Go table each).
- **One open payment per order** (a partial unique index), reused on every pay call, so double taps do not multiply Snap pages.
- **The fake gateway** (`APP_PAYMENT_PROVIDER=fake`) signs with a public key and would let anyone pay with nothing: the API and the worker refuse to start with it in production.

## API7: Server side request forgery

- The API fetches no URL a client gives it. Its outbound calls go to fixed URLs: Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`, 10-second timeout); when `BITESHIP_API_KEY` is set, Biteship's rates API (`https://api.biteship.com/v1/rates/couriers`, `APP_SHIPPING_TIMEOUT`); Midtrans' sandbox (`app.sandbox.midtrans.com`, `api.sandbox.midtrans.com`, `APP_PAYMENT_TIMEOUT`), where the only variable part of a URL is a payment's `order_id` that GoShop generated and path-escapes; and the configured S3 endpoint, with keys GoShop builds from its own ids. The worker also calls the configured SMTP server and Telegram's Bot API. A client only chooses which of its own addresses' postal codes is sent.

## API8: Security misconfiguration

- **Security headers** on every response, errors included (`httpapi.SecurityHeaders`): `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (tokens and personal data are never cached), and HSTS outside development.
- **CORS** allows only the origins listed in `APP_CORS_ALLOWED_ORIGINS`; `*` is refused, an empty list allows none, and credentials (cookies) are not allowed.
- **Errors never leak internals**: every 5xx is the generic `INTERNAL_ERROR`, with the cause in the log under the request ID, except the 503s the API builds on purpose with a message written for the client (`TIMEOUT`, `UPSTREAM_UNAVAILABLE`, and from Bab 6 `PAYMENTS_DISABLED`, `STORAGE_DISABLED`; `httpapi.ToAppError`); `healthx` hides check errors outside development.
- **Startup checks**: invalid or missing configuration stops the process with a message naming the variable, never repeating a secret.
- **Logs** carry no passwords, tokens or URLs with credentials; email bodies (with tokens) are logged only in development. Payment logs carry ids and statuses, never a signature or a key. The dead-letter listing (`worker dead-tasks list`) never prints payloads.
- **Placeholders that would be fine locally are refused elsewhere**: the `.env.example` JWT placeholder outside development, the fake payment gateway in production.
- **Image bucket:** uploads (originals, pending or confirmed) live under `uploads/`, the worker's variants under `products/`. The bucket is private; only `products/*` is publicly readable, which is all the storefront links. Locally SeaweedFS does the same (`deploy/seaweedfs/s3.json`: anonymous `Read:goshop/products/*`). In production, keep the bucket private and allow public reads of the `products/` prefix only (a bucket policy, or a CDN or R2 custom domain in front of that prefix). Keys contain random UUIDv7 ids and are never listed.
- Containers run as non-root on a distroless image; dev services bind to 127.0.0.1 only.

## API9: Improper inventory management

- Every endpoint is in `api/openapi.yaml`, linted in `make lint`, with its security scheme, error codes and limits. There are no hidden or development-only routes any more: the Bab 3 dev-only admin mount is gone.
- One API version (`/v1`) and one deployment per environment; staging and production never share secrets (`docs/configuration.md`).

## API10: Unsafe consumption of APIs

- Google ID tokens are verified with a maintained library (`github.com/coreos/go-oidc`), RS256 only, against Google's published keys, for our audience, with expiry; the email is used only when Google says it is verified, and only ASCII emails are stored.
- Values from Google (the name) go through the same text checks as user input before they are stored.
- **No nonce.** The client gets the ID token from Google itself (Google Sign-In on the web or the phone) and the API never starts that flow, so there is no nonce to check. A stolen ID token can be replayed to sign in until it expires (Google sets about one hour); that is bounded by the expiry the verifier checks, and by TLS, which keeps the token off the wire.
- **Midtrans notifications** (Bab 6) are verified by `signature_key` (SHA-512 of order_id, status_code, gross_amount and the server key, compared in constant time with sdk `hashx`), then treated as a hint only: the status that is applied comes from Midtrans' status API, whose answer is signature-checked too. Each distinct status is recorded once (`payment_events`), so replays are no-ops. The keys must be sandbox keys (`SB-Mid-…`) and `MIDTRANS_IS_PRODUCTION` must be false. Calls to Midtrans use `context.WithoutCancel` with their own timeout, so buyers hanging up cannot open the circuit breaker for everyone.
- **Uploaded files** are distrusted: a presigned URL promises the request, not the bytes, so confirm checks the stored object's size and type again, sniffs its real format, and reads its dimensions; the storefront only links the worker's re-encoded JPEGs (metadata such as a photo's GPS position dropped), never the original.
- **Telegram's** errors repeat the request URL, which holds the bot token; GoShop strips the URL before an error is logged or stored in the dead-letter queue.
- Biteship's answer is read through a 1 MiB limit with a timeout and a circuit breaker (sdk `httpx`); only services of the three known couriers with a positive price are kept, and the fee charged at checkout is always the one Biteship (or the fixed table) gives, never one from the client. A failure answers 503 `UPSTREAM_UNAVAILABLE` without the upstream's message.

## Checklist for a new endpoint

1. In `api/openapi.yaml`, with `security` and every 4xx it can answer.
2. Behind `Guard.Authenticate` unless it is public on purpose; behind `RequireRole` if it is staff-only.
3. User-owned data: the owner comes from the token and is in every query; another user's object is 404.
4. Request body: an explicit struct, validated, `ValidText` for every string, limits on every list.
5. Response: an explicit JSON struct with only the fields the caller may see.
6. Expensive or abusable (sends email, hashes, writes per request): a rate limit.
7. Nothing secret in logs or error messages.
