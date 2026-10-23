# GoShop API

The Go REST API behind the GoShop storefront, admin dashboard and mobile app. The contract is [`api/openapi.yaml`](../../api/openapi.yaml); the code must match it.

- Module: `github.com/santekno/shop-app/apps/api` (Go 1.26, see `.go-version`)
- Entry point: `cmd/api` (`api` serves; `api healthcheck` probes a running API, for Docker)
- Structure: one folder per feature under `internal/`, each with `model.go`, `repository.go`, `service.go` and `handler.go` ([ADR 0004](../../docs/adr/0004-api-layering.md)); the wiring is plain Go in `internal/app`

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | `/healthz` | Liveness: 200 while the process runs |
| GET | `/readyz` | Readiness: 503 while the server drains during shutdown, or while PostgreSQL (`postgres` check) or Redis (`redis` check) does not answer a ping |
| GET | `/v1/categories` | Every category, top-level first, sorted by name, from PostgreSQL (`make seed` fills it) |
| GET | `/v1/products` | One page of active products with their sellable variants, `price_from` and a computed `in_stock` |
| GET | `/v1/products/{slug}` | One active product; a malformed or unknown slug is 404 |
| POST | `/v1/auth/register` | Create a buyer account (argon2id password hash); 409 `EMAIL_TAKEN` for a registered email |
| POST | `/v1/auth/login` | Email + password → access token (JWT); 401 `INVALID_CREDENTIALS` for every failure, in the same time |
| POST | `/v1/auth/refresh` | Rotate the refresh token; a reused one revokes its whole session (ADR 0005) |
| POST | `/v1/auth/logout` | Revoke the session of a refresh token; always 204 |
| POST | `/v1/auth/verify-email` | Use the one-time token from the verification email (24 h) |
| POST | `/v1/auth/verify-email/resend` | **Access token.** Send a new verification email (202) |
| POST | `/v1/auth/forgot-password` | Email a 30-minute reset token if the account exists; always 202 |
| POST | `/v1/auth/reset-password` | New password with the reset token; revokes every session of the account |
| POST | `/v1/auth/google` | Google ID token → session; links by Google's subject id, never by email; 404 when `GOOGLE_CLIENT_ID` is unset (development) |
| GET | `/v1/me` | **Access token.** The caller's own account |
| PATCH | `/v1/me` | **Access token.** Change name and phone (`phone: null` removes it) |
| DELETE | `/v1/me` | **Access token.** Delete the account: anonymise it, delete its addresses, Google link and email tokens, end every session |
| GET, POST | `/v1/me/addresses` | **Access token.** The caller's address book (at most 20; exactly one default) |
| GET, PATCH, DELETE | `/v1/me/addresses/{id}` | **Access token.** One of the caller's addresses; anyone else's is 404 |
| GET | `/v1/cart` | **Optional token.** The cart: the user's with an access token, otherwise the guest cart of `X-Cart-Token`; lines with the current price, the price when added, stock and a `problem` per line |
| POST | `/v1/cart/items` | **Optional token.** Add a variant (the sum stays within 99 and the stock; at most 50 lines). A guest's first add creates a guest cart and returns its token once (`cart_token`, `X-Cart-Token`); 30 new guest carts per IP per hour |
| PATCH, DELETE | `/v1/cart/items/{variant_id}` | **Optional token.** Change a line's quantity (and accept a new price), or remove it |
| POST | `/v1/cart/merge` | **Access token.** Move the guest cart of `X-Cart-Token` into the user's cart, right after login ([ADR 0006](../../docs/adr/0006-cart-checkout-orders.md)) |
| POST | `/v1/checkout/preview` | **Access token.** Validate the cart as checkout will (409 `CHECKOUT_PROBLEMS` lists every line that is unavailable, short of stock or repriced) and compute the totals, with the shipping fee once `address_id`, `courier` and `service` are sent and the discount of `voucher_code` (409 `VOUCHER_NOT_APPLICABLE` says why one does not apply); writes nothing. `make seed` adds example vouchers (`HEMAT10`, `POTONG15RB`, `KILAT50`) |
| GET | `/v1/checkout/shipping-quotes?address_id=` | **Access token.** JNE, J&T and SiCepat services for the cart's weight to one of the caller's addresses, cheapest first (Biteship, or the fixed table without `BITESHIP_API_KEY`); 503 `UPSTREAM_UNAVAILABLE` when the rates API does not answer, 422 `SHIPPING_UNAVAILABLE` when no courier serves the address |
| POST | `/v1/checkout` | **Access token, verified email.** Turn the cart into an order waiting for payment, in one transaction (buyer row, then variants in id order, re-validated; guarded voucher and stock updates); 201 with `Location: /v1/orders/{id}`. At most 5 unpaid orders per buyer |
| POST | `/v1/admin/products` | **Seller or admin.** Create a product with its variants |
| GET | `/v1/admin/products/{id}` | **Seller or admin.** Any product, whatever its status |
| PUT | `/v1/admin/products/{id}` | **Seller or admin.** Save a product and its variants; variants left out are archived |
| DELETE | `/v1/admin/products/{id}` | **Seller or admin.** Archive a product (soft delete) |

Routes marked **Optional token** serve guests without an `Authorization` header; with one, the token must be valid (a bad token is 401, never a silent switch to the guest cart). Routes marked **Access token** need `Authorization: Bearer <access_token>` (401 `UNAUTHORIZED` without one); routes marked **Seller or admin** also need that role (403 `FORBIDDEN` for a buyer). The token design is [ADR 0005](../../docs/adr/0005-auth-tokens.md): refresh tokens live hashed in PostgreSQL; a revoked session (logout, a reused refresh token, a password reset, a deleted account) is also marked in Redis as `goshop:session-revoked:<sid>` for one access-token lifetime, and the auth middleware checks that key on every request, so the session's access tokens stop working at once. Without Redis, authenticated requests fail with 500 rather than skip the check.

### Security

[`SECURITY.md`](SECURITY.md) maps the OWASP API Security Top 10 (2023) to what the API does, with the known limits and a checklist for new endpoints. Every response carries `nosniff`, a `default-src 'none'` CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, plus HSTS outside development (`httpapi.SecurityHeaders`).

### Rate limits

Login, registration, forgot-password, Google sign-in, refresh, email verification, password reset and resending the verification email are rate limited with sdk `ratelimitx` (fixed windows in Redis, shared by every instance): per client IP (per account for resending), and for login and forgot-password also per email (hashed, so Redis holds no addresses). Over a limit the API answers 429 `RATE_LIMITED` with `Retry-After`. The limits are the `Limit*` values in `internal/auth/ratelimit.go`. An IPv6 client is counted by its /64 network, since one customer usually gets a whole /64. Behind a proxy, set `APP_TRUSTED_PROXY_HOPS` so the client IP comes from `X-Forwarded-For` (`1` on Railway; required outside development; [configuration](../../docs/configuration.md)). If Redis fails, the request fails (500) rather than skipping the limit.

From Bab 5 the checkout routes are limited per buyer too (artikel 08 adds the limits to all three at once, closing the gap the preview of artikel 04 and the quotes of artikel 06 leave open until then): `POST /v1/checkout/preview`, `GET /v1/checkout/shipping-quotes` and `POST /v1/checkout` each allow `APP_CHECKOUT_LIMIT_PER_MINUTE` requests per minute (30 by default). The k6 load test checks out far faster than a person, so its stack must be started with a high value (for example `APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up`).

### Email in development

There is no mail provider until Bab 6. Email goes through the `mail.Mailer` interface, and `mail.LogMailer` writes each message to the API's log instead of sending it: in development with the recipient and the whole body, so you can copy a verification or reset token from the output (`docker compose logs api | grep email`); in staging and production with the subject only, because a token in a log line would let anyone who reads the logs take over the account.

### A local admin

The API never makes an admin: every account starts as a buyer. On your machine, create one (or promote an existing account) with

```bash
SEED_ADMIN_PASSWORD='a-long-local-password' make seed-admin email=admin@goshop.local
```

The password comes from the environment, never a flag, so it stays out of the shell history and the process list. Promoting an existing account replaces its password and, like a password reset, revokes its refresh tokens in the same transaction. Unlike a reset it cannot reach Redis, so access tokens already issued keep working until they expire (`APP_ACCESS_TOKEN_TTL`, 15 minutes by default). Like `make seed`, it refuses a database that is not on this machine. A production admin is made by someone who already has database access, by hand, never by this tool.

Every write runs in one transaction that also recomputes `price_from` from the sellable variants. Two Bab 3 limitations: there is no optimistic locking yet, so when two admins save the same product at once the last save wins (Bab 5 adds the `version` check); and swapping two variants' SKUs, or reusing a SKU another variant of the product has right now, in one save answers 409 `SKU_TAKEN`, because each SKU is checked as its variant is written (save twice, through a temporary SKU).

Text must be valid UTF-8 without NUL characters (`httpapi.ValidText`), because PostgreSQL refuses anything else. A JSON body with a raw invalid UTF-8 byte inside a string is still accepted: `encoding/json` replaces the byte with U+FFFD before validation runs, so the stored text holds the replacement character. That is harmless, and the contract says so.

Every error, including unknown routes (404 `NOT_FOUND`) and wrong methods (405 `METHOD_NOT_ALLOWED`), uses the body `{"error":{"code","message","details?"}}`.

## Run it

All settings come from environment variables ([docs/configuration.md](../../docs/configuration.md)). `APP_ENV`, `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET` are required (and `GOOGLE_CLIENT_ID` outside development); everything else has a default. The API pings PostgreSQL once at start and exits if it cannot, then shares one connection pool (`APP_DB_*` sizes it) for its whole life and closes it after graceful shutdown.

Every connection asks Postgres for `plan_cache_mode=force_custom_plan` ([why](../../docs/explain/catalog.md#12-and-13-why-the-api-forces-custom-plans)); the API logs a warning at start when the session did not get it, and [docs/configuration.md](../../docs/configuration.md) says what to do behind a pooler.

```bash
# from the repository root
make up                       # the API in Docker on 127.0.0.1:8080, next to Postgres, Redis, SeaweedFS
curl -i localhost:8080/v1/categories

# or directly with Go, against the Compose postgres (make migrate-up && make seed first)
cd apps/api
APP_ENV=development DATABASE_URL='postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable' \
  REDIS_URL=redis://localhost:6379/0 JWT_SECRET=change-me-to-a-long-random-string go run ./cmd/api
```

### Hot reload

```bash
make dev-api                  # from the repository root
```

`make dev-api` reads `.env` when it exists (`cp .env.example .env`), defaults `APP_ENV` to `development`, and runs [Air](https://github.com/air-verse/air) with `apps/api/.air.toml`: every saved `.go` file rebuilds and restarts the API, and a change that does not compile keeps the last good server running. The old server gets SIGINT, so it shuts down gracefully, exactly as in production.

Nothing needs installing: the first run builds the pinned Air version (`AIR_VERSION` in the `Makefile`) into `apps/api/bin/` (gitignored). To use your own copy instead: `go install github.com/air-verse/air@v1.67.4` and run `air` inside `apps/api`.

The Docker `api` service from `make up` also uses port 8080. Stop it first (`docker compose stop api`) or pick another port: `PORT=8081 make dev-api`. Use `PORT`, not `APP_PORT`: `make dev-api` loads `.env` after your shell, so the `APP_PORT` in `.env` would replace yours, while `.env` never sets `PORT` and `PORT` wins over `APP_PORT`.

## Database migrations

The schema lives in [`migrations/`](migrations) as [golang-migrate](https://github.com/golang-migrate/migrate) pairs: `000001_create_catalog.up.sql` applies a change, `000001_create_catalog.down.sql` reverses it exactly. Every migration has both halves, and a migration that has run anywhere but your machine is never edited: write a new one.

```bash
make migrate-up                  # apply new migrations to the Compose postgres
make migrate-down                # roll back the newest one (refuses a non-local database)
make migrate-new name=add_users  # create 000002_add_users.up.sql / .down.sql
```

These targets use the golang-migrate CLI, pinned (`MIGRATE_VERSION` in the `Makefile`) and built into `apps/api/bin/` on first use. They talk to `DATABASE_URL` from your shell, or the Compose postgres when it is unset; `.env` is deliberately not read, so a URL you pasted there never receives a `migrate-down`. `make migrate-down` with nothing left to roll back prints golang-migrate's `error: file does not exist`.

**The API never migrates when it starts.** During a rollout, old and new instances run side by side; a server that migrated on start would change the schema under the old ones, and several new instances would race to do it. Instead the migrations are embedded in the binary and applied by a separate command, `api migrate`, which only goes up:

| Where | Who runs `api migrate` |
|---|---|
| `make up`, `make test-integration` | the one-shot Compose service `migrate` (same image as `api`); `api` waits until it exits successfully |
| Railway | the api service's `preDeployCommand` in `deploy/railway/api.json`; a failed migration stops the deploy, and the old version keeps serving |

The CLI and `api migrate` share golang-migrate's `schema_migrations` table and its advisory lock, so they agree on the version and never run at the same time.

Two things to know before the first Railway deploy:

- **A failed migration stops every later deploy.** golang-migrate marks the version *dirty* when a migration fails halfway, and refuses to run again until someone repairs the schema by hand and runs `migrate force <version>` (with the CLI, against that database). Test each migration locally with `make migrate-up`, `make migrate-down` and `make migrate-up` before it ships.
- **Migrations run while the old version still serves.** The pre-deploy command runs before the new instances start, so the running code must keep working on the new schema. Change it in two steps: *expand* (add a nullable column or a new table) and ship the code that uses it, then *contract* (drop what is no longer used) in a later migration.

From Bab 4 the api service also needs, in every Railway environment: a Redis service with its `REDIS_URL` referenced into the api's variables, a `JWT_SECRET` generated for that environment (`openssl rand -base64 48`; the placeholder is refused), `GOOGLE_CLIENT_ID`, and `APP_TRUSTED_PROXY_HOPS=1` (required outside development; Railway's edge is one proxy that overwrites `X-Forwarded-For` with the connecting address, so check the header on a real request after the first deploy; see [configuration](../../docs/configuration.md)). `deploy/railway/api.json` cannot carry these: Railway's config-as-code schema has no field for variables, so they are set per environment in the Railway dashboard. `/readyz` fails until Redis answers, so a deploy without it never takes traffic.

`preDeployCommand` is `["/api migrate"]`. The image has no shell, so confirm on the first deploy that Railway splits it into the binary and its argument; if not, write it as `["/api", "migrate"]`.

Railway's deploy healthcheck (`healthcheckPath` in `deploy/railway/api.json`) is `/readyz`, not `/healthz`: Railway only calls it while a new deployment starts, to decide when to switch traffic to it, and never restarts a running container because of it. So it should answer "can this instance serve requests", which includes reaching PostgreSQL. Docker's `HEALTHCHECK` keeps probing `/healthz`, because a container restart does not fix a database outage.

## Queries with sqlc

SQL is written by hand in [`internal/db/queries/`](internal/db/queries), one file per table group, and [sqlc](https://sqlc.dev) turns each named query into a typed Go method in `internal/db/sqlc` (configuration: [`sqlc.yaml`](sqlc.yaml); schema read from `migrations/`). The generated code is committed, never edited, and excluded from coverage.

```bash
make sqlc         # regenerate after changing a query or a migration
make sqlc-check   # fail when the committed code does not match the SQL (part of make lint)
```

Repositories call the generated methods and map their rows to the feature's own types, so a column change surfaces as a compile error in one place. Like golangci-lint, sqlc is pinned (`SQLC_VERSION`) and built into `apps/api/bin/` on first use; it needs a C compiler, because it embeds PostgreSQL's parser.

`go.mod` lists `github.com/lib/pq` although the API talks to PostgreSQL through pgx. sqlc's `database/sql` output passes array parameters (the category filter's `uuid[]`, the variants to keep when archiving) through `pq.Array`, which only turns a Go slice into a Postgres array literal. No connection is ever opened with lib/pq.

## API documentation

```bash
make docs-api                 # from the repository root
open dist/api-docs/index.html # macOS; xdg-open on Linux
```

`make docs-api` renders `api/openapi.yaml` into one static HTML page with the same pinned Redocly CLI that `make lint` uses for the contract. The page is static but not self-contained: it loads the Redoc script from `cdn.redocly.com` and fonts from Google Fonts, so opening it needs network access. `dist/` is gitignored: the page is rebuilt from the contract, never edited or committed. The API itself does not serve the docs: `api/openapi.yaml` lives outside the Go module, so embedding it would mean keeping a second copy in sync, and a static page can be opened or hosted anywhere.

## Checks

```bash
make build lint docker-build  # compile, go vet + golangci-lint (apps/api/.golangci.yml), images
make test-unit                # unit tests with the coverage threshold
```

`make lint` builds the pinned golangci-lint (`GOLANGCI_VERSION` in the `Makefile`) with the module's Go toolchain on first use, because a golangci-lint built with an older Go refuses to lint a `go 1.26` module.

## Testing against PostgreSQL

Every repository takes a `*sql.DB` (`category.NewPostgresRepository(db)`, `product.NewPostgresRepository(db)`), and `app.New(cfg, logger, db)` takes the pool too, so a test hands them a real database instead of a mock. The integration tests (`apps/api/tests/integration`, owned by integration-engineer) give **every test its own database**, from `db_test.go`:

```go
dsn, db := newTestDB(t) // a new it_<random> database, migrated and empty, plus a pool on it
dsn := newDatabase(t)   // the same without migrations, for the migration tests
```

- **Where Postgres comes from.** santekno/sdk v0.2.0's `testx.PostgresContainer` does not start a container: it returns `POSTGRES_DSN`, or skips the test ([sdk gaps](../../docs/sdk-gaps.md)). `make test-integration` starts the Compose stack, exports `POSTGRES_DSN`, and fails on any skipped test.
- **One database per test.** `newDatabase` connects to the server in `POSTGRES_DSN`, runs `CREATE DATABASE it_<random>`, and registers a cleanup that runs `DROP DATABASE … WITH (FORCE)` after the test's own pools and servers have closed, ending any connection still open. `newTestDB` applies the migrations with `database.Migrate` and opens a small pool through `database.Open`, as the API does. A test that starts the API in-process sets `DATABASE_URL` to its own database.
- **The `goshop` database is never touched.** It holds your seed and is what `make up` serves; only the Compose stack test reads it, through the API, and it checks shapes, not counts.
- **Why not one shared database.** A shared one makes every test defensive: unique slugs, no counting, cleanup by hand, and a crash that leaves rows behind for the next run. Tests running in parallel would also see each other's rows. With a database per test, each one starts from empty tables, may count rows and assert exact pages, and leaves nothing behind. Creating a database takes a few tens of milliseconds.
- **Admin routes** need an access token with the `seller` or `admin` role. A test creates the account (or sets its role) in its own database and logs in, or signs a token with the test's `JWT_SECRET`.

## Testing the auth flows

`app.New(cfg, logger, db, rdb, opts...)` takes the PostgreSQL pool and the Redis client, and every dependency of the auth flows that a test cannot control in real life has an option:

| Option | Replaces | Why a test needs it |
|---|---|---|
| `app.WithMailer(m)` | `mail.LogMailer` | read the verification and reset tokens from the messages instead of the log |
| `app.WithGoogleVerifier(v)` | go-oidc against Google | a real Google ID token needs a real Google account; a fake returns a fixed `auth.GoogleIdentity` (or an error) |
| `app.WithRateLimiter(l)` | Redis `ratelimitx` counters | hit a limit on demand, or switch limits off for a test that logs in many times |
| `app.WithSessionRevocations(r)` | Redis revocation keys | check what was revoked without Redis |
| `app.WithClock(now)` | `time.Now` | expire refresh, verification and reset tokens without waiting. sdk jwtx checks an access token's `exp` against the wall clock, so move the clock forward only |

One level down, `auth.NewService(auth.Deps{...})` also takes `Random` (token secrets) and `NewID` (row IDs), and `auth.Hasher` can be a fast fake instead of argon2id. Each repository takes a `*sql.DB`, so the integration tests use a real database per test.

## Validation for later chapters

`httpapi.Validator.BindQuery` fills a struct from the URL query (`query:"name"` tags; string, int, int64, bool) and validates it with `validx` (`validate:"…"` tags). Failures become one 400 `VALIDATION_FAILED` with a message per field, as in the contract. Its first consumer is `GET /v1/products` in Bab 3: `GET /v1/categories` has no parameters.

`Validator.Struct` (for request bodies, from Bab 4) names top-level fields by their `json` tag and builds their message from their `validate` tag. A field inside a nested struct is reported by its Go name (`City`), with a message from the failed rule alone, and never borrows the tags of a top-level field with the same name: a documented limitation until a chapter sends a nested body (see `docs/sdk-gaps.md`).
