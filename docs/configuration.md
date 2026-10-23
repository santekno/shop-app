# Configuration

Every GoShop service reads its configuration from **environment variables**, and from nothing else: no config files per environment, no values compiled into the binary or baked into a Docker image. The same image runs in development, staging and production; only the variables change.

`.env.example` lists every variable with a safe placeholder. For local development:

```bash
cp .env.example .env   # .env is gitignored; never commit it
```

## Variables

"Reads it" names the service that uses the variable. The worker (Bab 6) shares the API's Go module and reads the same database, Redis and storage settings. The web, admin and mobile apps never see these values; their own public settings (such as the API URL) arrive with each app.

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
| `REDIS_ADDR` | api, worker | no | Redis `host:port`. | Bab 4 |
| `JWT_SECRET` | api | **yes** | HS256 key that signs access tokens ([ADR 0005](adr/0005-auth-tokens.md)). Required; at least 32 bytes; different per environment. The `.env.example` placeholder (or anything containing `change-me`) is accepted in development only: staging and production refuse to start with it. Rotating it ends every access token at once; clients refresh. | Bab 4 |
| `APP_REFRESH_TOKEN_TTL` | api | no | How long a refresh token lives after it is issued (Go duration, `1h`–`2160h`, default `720h` = 30 days). Every refresh issues a new one, so an active user stays logged in and an idle one is logged out. | Bab 4 |
| `APP_ACCESS_TOKEN_TTL` | api | no | How long an access token lives (Go duration, `1m`–`1h`, default `15m`). Also how long a revoked session's marker stays in Redis. | Bab 4 |
| `S3_ENDPOINT` | api, worker | no | S3 API endpoint. SeaweedFS locally (`http://localhost:8333`), the provider's endpoint in production. | Bab 6 |
| `S3_BUCKET` | api, worker | no | Bucket for product and review images. | Bab 6 |
| `S3_ACCESS_KEY` | api, worker | **yes** | S3 access key. | Bab 6 |
| `S3_SECRET_KEY` | api, worker | **yes** | S3 secret key. | Bab 6 |
| `MIDTRANS_SERVER_KEY` | api | **yes** | Midtrans server key: creates transactions and verifies webhook signatures. Sandbox key only in this course. | Bab 6 |
| `MIDTRANS_CLIENT_KEY` | api | no | Midtrans client key, passed to Snap in the browser and the app. Public by design, but still per environment. | Bab 6 |
| `GOOGLE_CLIENT_ID` | api | no | OAuth client ID for "Sign in with Google". | Bab 4 |
| `GOOGLE_CLIENT_SECRET` | api | **yes** | OAuth client secret. | Bab 4 |
| `OPENAI_API_KEY` | api, worker | **yes** | Key for the LLM and embedding provider. | Bab 18 |

A variable that a chapter does not use yet may stay empty. When a chapter starts using one, the service must fail at startup if it is missing, instead of failing on the first request.

### Integration tests

`make test-integration` starts the Compose dependencies (the one-shot `migrate` service applies the migrations first) and sets these variables for the Go integration tests:

| Variable | Value | Read by |
|---|---|---|
| `POSTGRES_DSN` | `postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable` | `testx.PostgresContainer` only. **Test-only**: the services read `DATABASE_URL`. |
| `DATABASE_URL` | the same database | the API when an integration test starts it in-process with `config.Load` |
| `REDIS_ADDR` | `localhost:6379` | `testx.RedisContainer`, and the api/worker at runtime (see the table above) |
| `S3_ENDPOINT` | `http://localhost:8333` | storage integration tests, and the api/worker at runtime (see the table above) |

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
