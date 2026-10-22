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
| `DATABASE_URL` | api, worker | **yes** | PostgreSQL connection string. Locally points at the Compose `postgres` service. | Bab 3 |
| `REDIS_ADDR` | api, worker | no | Redis `host:port`. | Bab 4 |
| `JWT_SECRET` | api | **yes** | Key that signs access tokens. At least 32 random bytes; different per environment. | Bab 4 |
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

`make test-integration` starts the Compose dependencies and sets three variables for the Go integration tests:

| Variable | Value | Read by |
|---|---|---|
| `POSTGRES_DSN` | `postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable` | `testx.PostgresContainer` only. **Test-only**: the services read `DATABASE_URL`. |
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
