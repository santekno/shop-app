# GoShop API

The Go REST API behind the GoShop storefront, admin dashboard and mobile app. The contract is [`api/openapi.yaml`](../../api/openapi.yaml); the code must match it.

- Module: `github.com/santekno/shop-app/apps/api` (Go 1.26, see `.go-version`)
- Entry point: `cmd/api` (`api` serves; `api healthcheck` probes a running API, for Docker)
- Structure: one folder per feature under `internal/`, each with `model.go`, `repository.go`, `service.go` and `handler.go` ([ADR 0004](../../docs/adr/0004-api-layering.md)); the wiring is plain Go in `internal/app`

## Endpoints

| Method | Path | What |
|---|---|---|
| GET | `/healthz` | Liveness: 200 while the process runs |
| GET | `/readyz` | Readiness: 503 while the server drains during shutdown, or while PostgreSQL does not answer a ping (`postgres` check) |
| GET | `/v1/categories` | Every category, top-level first, sorted by name, from PostgreSQL (`make seed` fills it) |
| GET | `/v1/products` | One page of active products with their sellable variants, `price_from` and a computed `in_stock` |
| GET | `/v1/products/{slug}` | One active product; a malformed or unknown slug is 404 |
| POST | `/v1/auth/register` | Create a buyer account (argon2id password hash); 409 `EMAIL_TAKEN` for a registered email |
| POST | `/v1/auth/login` | Email + password → access token (JWT); 401 `INVALID_CREDENTIALS` for every failure, in the same time |
| POST | `/v1/auth/refresh` | Rotate the refresh token; a reused one revokes its whole session (ADR 0005) |
| POST | `/v1/auth/logout` | Revoke the session of a refresh token; always 204 |
| GET | `/v1/me` | **Access token.** The caller's own account |
| POST | `/v1/admin/products` | **Seller or admin.** Create a product with its variants |
| GET | `/v1/admin/products/{id}` | **Seller or admin.** Any product, whatever its status |
| PUT | `/v1/admin/products/{id}` | **Seller or admin.** Save a product and its variants; variants left out are archived |
| DELETE | `/v1/admin/products/{id}` | **Seller or admin.** Archive a product (soft delete) |

Routes marked **Access token** need `Authorization: Bearer <access_token>` (401 `UNAUTHORIZED` without one); routes marked **Seller or admin** also need that role (403 `FORBIDDEN` for a buyer). The token design is [ADR 0005](../../docs/adr/0005-auth-tokens.md).

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

All settings come from environment variables ([docs/configuration.md](../../docs/configuration.md)). `APP_ENV`, `DATABASE_URL` and `JWT_SECRET` are required; everything else has a default. The API pings PostgreSQL once at start and exits if it cannot, then shares one connection pool (`APP_DB_*` sizes it) for its whole life and closes it after graceful shutdown.

Every connection asks Postgres for `plan_cache_mode=force_custom_plan` ([why](../../docs/explain/catalog.md#12-and-13-why-the-api-forces-custom-plans)); the API logs a warning at start when the session did not get it, and [docs/configuration.md](../../docs/configuration.md) says what to do behind a pooler.

```bash
# from the repository root
make up                       # the API in Docker on 127.0.0.1:8080, next to Postgres, Redis, SeaweedFS
curl -i localhost:8080/v1/categories

# or directly with Go, against the Compose postgres (make migrate-up && make seed first)
cd apps/api
APP_ENV=development DATABASE_URL='postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable' go run ./cmd/api
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

## Validation for later chapters

`httpapi.Validator.BindQuery` fills a struct from the URL query (`query:"name"` tags; string, int, int64, bool) and validates it with `validx` (`validate:"…"` tags). Failures become one 400 `VALIDATION_FAILED` with a message per field, as in the contract. Its first consumer is `GET /v1/products` in Bab 3: `GET /v1/categories` has no parameters.

`Validator.Struct` (for request bodies, from Bab 4) names top-level fields by their `json` tag and builds their message from their `validate` tag. A field inside a nested struct is reported by its Go name (`City`), with a message from the failed rule alone, and never borrows the tags of a top-level field with the same name: a documented limitation until a chapter sends a nested body (see `docs/sdk-gaps.md`).
