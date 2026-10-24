# Configuration

Every GoShop service reads its configuration from **environment variables**, and from nothing else: no config files per environment, no values compiled into the binary or baked into a Docker image. The same image runs in development, staging and production; only the variables change.

`.env.example` lists every variable with a safe placeholder. For local development:

```bash
cp .env.example .env   # .env is gitignored; never commit it
```

## Variables

"Reads it" names the service that uses the variable. The worker (Bab 6, `apps/api/cmd/worker`) shares the API's Go module and **loads the same configuration**: it validates every variable the API does (so `JWT_SECRET`, `GOOGLE_CLIENT_ID` and `APP_TRUSTED_PROXY_HOPS` are required for it too outside development, though it uses none of them), and listens on `PORT`/`APP_PORT` for its health checks only. The web, admin and mobile apps never see these values; their own public settings (such as the API URL) arrive with each app.

| Variable | Reads it | Secret | Purpose | Used from |
|---|---|---|---|---|
| `APP_ENV` | api, worker | no | `development`, `staging` or `production`. Switches log format and safety checks, never business logic. | Bab 2 |
| `APP_PORT` | api | no | Port to listen on when `PORT` is not set (local default `8080`). | Bab 2 |
| `PORT` | api | no | Set by Railway at runtime. When present it wins over `APP_PORT`. Do not put it in `.env`. | Bab 2 |
| `APP_LOG_LEVEL` | api, worker | no | `debug`, `info` (default), `warn` or `error`. Development logs human-readable text, every other environment one JSON object per line. | Bab 2 |
| `APP_CORS_ALLOWED_ORIGINS` | api | no | Comma-separated browser origins allowed to call the API, e.g. `http://localhost:5173,https://shop.example.com` (scheme and host, no path or trailing slash). Empty means no cross-origin browser access; `*` is refused. | Bab 2 |
| `APP_REQUEST_TIMEOUT` | api | no | How long one request may run (Go duration, `1s`–`60s`, default `15s`). Past it the context is cancelled and the client gets 503 `TIMEOUT`. | Bab 2 |
| `APP_DRAIN_DELAY` | api | no | After SIGTERM, how long `/readyz` answers 503 while requests are still served, so a load balancer stops routing here first (Go duration, `0s`–`60s`, default `0s`; use a few seconds behind a load balancer). | Bab 2 |
| `APP_SHUTDOWN_TIMEOUT` | api | no | How long in-flight requests may take to finish during shutdown (Go duration, `1s`–`60s`, default `10s`). Keep drain delay + shutdown timeout below the platform's kill timeout. | Bab 2 |
| `DATABASE_URL` | api, worker | **yes** | PostgreSQL connection string, `postgres://user:pass@host:5432/dbname?sslmode=…`. Required: the API does not start without it, or when the first ping fails. Locally `.env` points at the Compose `postgres` on `localhost` (for `make dev-api`, `make seed`); the Compose `api` and `migrate` services use the host `postgres` instead. No error message or log line repeats it. The API adds `plan_cache_mode=force_custom_plan` unless the URL sets `plan_cache_mode` itself ([why](explain/catalog.md#12-and-13-why-the-api-forces-custom-plans)), and logs a warning at start when the session does not have it. A pooler that drops startup parameters (PgBouncer in transaction mode) loses it; then set it on the server with `ALTER ROLE <user> SET plan_cache_mode = force_custom_plan`. | Bab 3 |
| `APP_DB_MAX_OPEN_CONNS` | api | no | Most connections one API instance opens (`1`–`100`, default `10`). A request that needs one more waits for a free one. Instances × this value must stay below the Postgres plan's connection limit, with room for the worker and migrations. | Bab 3 |
| `APP_DB_MAX_IDLE_CONNS` | api | no | Unused connections kept open for the next request (`1` up to `APP_DB_MAX_OPEN_CONNS`, default `5`). | Bab 3 |
| `APP_DB_CONN_MAX_LIFETIME` | api | no | Age after which a connection is closed and replaced (Go duration, `1m`–`24h`, default `30m`), so a database failover or proxy can move connections. | Bab 3 |
| `REDIS_URL` | api, worker | **yes** | Redis connection, `redis://host:6379/0` (`rediss://` for TLS; a password, when the server has one, goes in the URL's user-info part, as Railway's URL does). Required: the API pings it at start and exits if it cannot, because authenticated requests (session revocation) and rate limits need it; `/readyz` reports it as the `redis` check. Railway's Redis service provides it under this name. It may hold a password, so no log line or error repeats it. | Bab 4 |
| `APP_TRUSTED_PROXY_HOPS` | api | no | How many proxies in front of the API set the client address in `X-Forwarded-For` (`0`–`5`). The per-IP rate limits use the entry that many places from the right; entries further left were sent by the client and can be forged. Defaults to `0` in development only (the TCP peer, right for `make up`); **staging and production must set it**, because no default is safe: too high lets a client forge its address, too low puts every user behind the proxy's one address. **On Railway set `1`**: requests reach the service through one Railway edge proxy, which, according to Railway staff on the Railway Help Station, overwrites `X-Forwarded-For` (and `X-Real-IP`) with the address that connected to it rather than appending to what the client sent, so the header holds one entry. Railway's own specs ([public networking: specs and limits](https://docs.railway.com/networking/public-networking/specs-and-limits)) document `X-Real-IP` as the client's address and do not describe `X-Forwarded-For`, so check the header on a real request after the first deploy. A CDN in front of Railway adds hops. | Bab 4 |
| `JWT_SECRET` | api | **yes** | HS256 key that signs access tokens ([ADR 0005](adr/0005-auth-tokens.md)). Required; at least 32 bytes; different per environment. The `.env.example` placeholder (or anything containing `change-me`) is accepted in development only: staging and production refuse to start with it. Rotating it ends every access token at once; clients refresh. | Bab 4 |
| `APP_REFRESH_TOKEN_TTL` | api | no | How long a refresh token lives after it is issued (Go duration, `1h`–`2160h`, default `720h` = 30 days). Every refresh issues a new one, so an active user stays logged in and an idle one is logged out. | Bab 4 |
| `APP_ACCESS_TOKEN_TTL` | api | no | How long an access token lives (Go duration, `1m`–`1h`, default `15m`). Also how long a revoked session's marker stays in Redis. | Bab 4 |
| `BITESHIP_API_KEY` | api | **yes** | Key for [Biteship](https://biteship.com)'s rates API, which prices shipping by postal code for JNE, J&T and SiCepat ([ADR 0006](adr/0006-cart-checkout-orders.md)). **Empty turns Biteship off**: the API then prices from a fixed table per started kilogram (`shipping.Static`) in every environment, and logs `shipping fees provider=static` at start. Use a test key (Biteship's dashboard → API keys) outside production. | Bab 5 |
| `APP_SHIPPING_ORIGIN_POSTAL_CODE` | api | no | Postal code of the warehouse parcels leave from, five digits such as `40111`. **Required when `BITESHIP_API_KEY` is set**; the fixed table ignores it. | Bab 5 |
| `APP_SHIPPING_TIMEOUT` | api | no | How long checkout waits for the rates API (Go duration, `1s`–`15s`, default `5s`). Past it the request answers 503 `UPSTREAM_UNAVAILABLE`; the call is never retried, and it is made before the checkout transaction, so a slow courier API never holds a row lock. | Bab 5 |
| `APP_PAYMENT_TTL` | api | no | How long a buyer has to pay an order (Go duration, `5m`–`72h`, default `24h`, Midtrans' default expiry; at least 5 minutes, because Snap stops taking payment a minute before the deadline and counts whole minutes). Stock is taken at checkout and returned when an unpaid order passes this deadline (`api expire-orders`). | Bab 5 |
| `APP_CHECKOUT_LIMIT_PER_MINUTE` | api | no | How many checkout previews, shipping quotes and checkouts one buyer may ask for per minute, each (`1`–`100000`, default `30`); past it the API answers 429 `RATE_LIMITED`. Raise it only for a load test (the k6 test in `e2e/k6` needs `100000`: `e2e/k6/run.sh` refuses to run below it, `APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up`), never in production. | Bab 5 |
| `SMTP_HOST` | api, worker | no | SMTP server for email ([ADR 0007](adr/0007-payments-uploads-worker.md)). **Empty keeps the log mailer**: emails are written to the log (bodies, with their tokens, in development only). Set, the API queues its emails (verification, reset) and the worker sends them with the order emails. TLS is required (STARTTLS, or port 465), except to a server on this machine. To see emails locally, run [Mailpit](https://mailpit.axllent.org) (`docker run -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`) and set `SMTP_HOST=localhost`, `SMTP_PORT=1025` for `make dev-api` and a worker run on the host. | Bab 6 |
| `SMTP_PORT` | api, worker | no | `1`–`65535`, default `587` (STARTTLS); `465` uses TLS from the first byte. | Bab 6 |
| `SMTP_USERNAME` | api, worker | no | SMTP login; set with `SMTP_PASSWORD` or neither. | Bab 6 |
| `SMTP_PASSWORD` | api, worker | **yes** | SMTP password. Never logged. | Bab 6 |
| `SMTP_FROM` | api, worker | no | The sender, e.g. `GoShop <no-reply@shop.example>`. Required with `SMTP_HOST`. | Bab 6 |
| `TELEGRAM_BOT_TOKEN` | worker | **yes** | Token of the Telegram bot (from @BotFather) that tells the seller about each newly paid order ([ADR 0007](adr/0007-payments-uploads-worker.md)). Set with `TELEGRAM_CHAT_ID`, or neither: **both empty turn the messages off**. The token is part of every Bot API URL, so GoShop strips URLs from Telegram errors before logging them. | Bab 6 |
| `TELEGRAM_CHAT_ID` | worker | no | The seller's chat or group id (a group's id is negative, e.g. `-1001234567890`; add the bot to the group first). | Bab 6 |
| `APP_WORKER_CONCURRENCY` | worker | no | How many tasks one worker process runs at once (`1`–`50`, default `5`). Each running task may hold a database connection, so keep it at or below `APP_DB_MAX_OPEN_CONNS`. | Bab 6 |
| `S3_ENDPOINT` | api, worker | no | How the API and the worker reach the S3 API: SeaweedFS locally (`http://localhost:8333`, `http://storage:8333` inside Compose), the provider's endpoint in production (Cloudflare R2: `https://<account>.r2.cloudflarestorage.com`). **Empty turns image uploads off** (503 `STORAGE_DISABLED`). `api migrate` creates the bucket when it is missing ([ADR 0007](adr/0007-payments-uploads-worker.md)). | Bab 6 |
| `S3_PRESIGN_ENDPOINT` | api | no | The endpoint presigned upload URLs are signed for, when clients reach S3 by another address than the API does (Compose: `http://localhost:8333`). Empty means `S3_ENDPOINT`. | Bab 6 |
| `S3_PUBLIC_URL` | api, worker | no | Base URL the public reads images from, without a trailing slash: a CDN or the bucket's public domain (R2: `https://pub-….r2.dev`). Empty means `<S3_PRESIGN_ENDPOINT>/<S3_BUCKET>`. Only the worker's variants under `products/` are linked; keep the bucket private and allow public reads of `products/*` only (originals under `uploads/` stay private). The local SeaweedFS does exactly that (`deploy/seaweedfs/s3.json`). | Bab 6 |
| `S3_REGION` | api, worker | no | Region of the bucket (default `us-east-1`; `auto` for R2). | Bab 6 |
| `S3_BUCKET` | api, worker | no | Bucket for product images. Required with `S3_ENDPOINT`. | Bab 6 |
| `S3_ACCESS_KEY` | api, worker | **yes** | S3 access key. Required with `S3_ENDPOINT`. | Bab 6 |
| `S3_SECRET_KEY` | api, worker | **yes** | S3 secret key. Required with `S3_ENDPOINT`; the local SeaweedFS value `goshop-secret` is refused outside development. | Bab 6 |
| `APP_PAYMENT_PROVIDER` | api, worker | no | `midtrans` (default) or `fake`: `internal/payment/fake`, a stand-in for Midtrans with its transactions in Redis, so a developer pays an order with `make fake-pay order=GS-…` (it signs and sends the notification Midtrans would). **The API and the worker refuse `fake` when `APP_ENV=production`.** `make up` uses `fake` unless `.env` says otherwise. | Bab 6 |
| `MIDTRANS_SERVER_KEY` | api, worker | **yes** | Midtrans **sandbox** server key (`SB-Mid-server-…`, from dashboard.sandbox.midtrans.com → Settings → Access keys). It authenticates every call to Midtrans and is the key notifications are signed with ([ADR 0007](adr/0007-payments-uploads-worker.md)). **Empty turns payments off**: `POST /v1/orders/{id}/pay` and the notification route answer 503 `PAYMENTS_DISABLED`, and the API logs a warning at start. A key that is not a sandbox key stops the API at start. | Bab 6 |
| `MIDTRANS_CLIENT_KEY` | api | no | Midtrans sandbox client key (`SB-Mid-client-…`), returned to clients as `client_key` for Snap.js. Public by design, but per environment. Required with the server key. | Bab 6 |
| `MIDTRANS_IS_PRODUCTION` | api, worker | no | Must be `false` (or empty): GoShop talks to the Midtrans sandbox only, and refuses to start with `true`. | Bab 6 |
| `APP_PAYMENT_TIMEOUT` | api, worker | no | How long one call to Midtrans may take (Go duration, `1s`–`30s`, default `10s`). Past it the request answers 503 `UPSTREAM_UNAVAILABLE`. Calls are never made inside a database transaction, and never retried. | Bab 6 |
| `GOOGLE_CLIENT_ID` | api | no | OAuth client ID for "Sign in with Google" (ends with `.apps.googleusercontent.com`). `POST /v1/auth/google` accepts only Google ID tokens issued to this client. Required in staging and production; empty in development turns Google sign-in off (the endpoint answers 404). Public by design, but per environment. There is no `GOOGLE_CLIENT_SECRET`: the API only verifies ID tokens against Google's public keys, which needs no secret. | Bab 4 |
| `OPENAI_API_KEY` | api, worker | **yes** | Key for the LLM and embedding provider. | Bab 18 |

A variable that a chapter does not use yet may stay empty. When a chapter starts using one, the service must fail at startup if it is missing, instead of failing on the first request.

### Integration tests

`make test-integration` starts the Compose dependencies (the one-shot `migrate` service applies the migrations first) and sets these variables for the Go integration tests:

| Variable | Value | Read by |
|---|---|---|
| `POSTGRES_DSN` | `postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable` | `testx.PostgresContainer` only. **Test-only**: the services read `DATABASE_URL`. |
| `DATABASE_URL` | the same database | the API when an integration test starts it in-process with `config.Load` |
| `REDIS_ADDR` | `localhost:6379` | `testx.RedisContainer` only. **Test-only**: the services read `REDIS_URL`. |
| `REDIS_URL` | `redis://localhost:6379/0` | the API when an integration test starts it in-process with `config.Load` |
| `JWT_SECRET` | a key for tests only | the same |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | `http://localhost:8333`, `goshop`, the local SeaweedFS keys | storage integration tests, and the API started in-process |

When `POSTGRES_DSN` or `REDIS_ADDR` is missing, testx skips the test, and the gate fails on any skipped test.

## Development, staging and production

| | Development | Staging | Production |
|---|---|---|---|
| Where values live | `.env` on your machine, copied from `.env.example` | Railway variables of the staging environment | Railway variables of the production environment |
| `APP_ENV` | `development` | `staging` | `production` |
| Database, Redis, storage | Docker Compose services (`make up`) | Their own Railway services or buckets, separate from production | Their own Railway services or buckets |
| Secrets | Placeholders from `.env.example`, or your personal sandbox keys | Generated for staging only | Generated for production only, known to as few people as possible |
| Midtrans | Sandbox | Sandbox | Production keys only when the shop really takes money; this course stays on sandbox |
| Data | Seed data, safe to wipe | Seed or anonymised data | Real customer data |

Rules that hold across all three:

- **Never share a secret between environments.** A leaked staging key must not open production.
- **Never copy production data into development** without removing personal data first.
- **Configuration is not code.** Feature behaviour must not depend on `APP_ENV`; it only changes things like log format, debug endpoints and how strict startup checks are.

## Secrets

- Secrets live **only** in the platform's secret store: Railway variables for staging and production (per service, per environment), your local `.env` for development.
- Secrets are **never committed**, not even in a branch that is later deleted: Git history keeps them. `make scan` fails if a `.env` file or anything shaped like a provider key is tracked.
- `.env.example` contains placeholders only. Adding a variable means adding it there, in this table, and in the Railway variables of every environment.
- Secrets are never logged, never returned in an API response, and never pasted into an AI prompt (see [AI rules](ai-rules.md)).
- If a secret leaks, rotate it first, then clean up.

To generate a strong value for `JWT_SECRET`:

```bash
openssl rand -base64 48
```
