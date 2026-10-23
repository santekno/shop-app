# Bab 3 — Database: PostgreSQL, migrasi & sqlc

Branch: `bab-3` (from `bab-2` @ `2aaaf8d`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | migrations embedded and applied by `api migrate`; sqlc (database/sql) with `sqlc-check`; sdk `sqlx` over pgx stdlib |
| 1 unit tests | test-engineer | pass | 82.7% coverage; 66 mutation checks |
| 2 DB audit | database-auditor | pass | 2 rounds on a 100k-product throwaway database: 1 blocking (the category filter never used an index), fixed, then 0 blocking |
| 3 integration | integration-engineer | pass | a migrated `it_<rand>` database per test; repositories, migrations, pool, `Run` and every route against real PostgreSQL; 995 passed, 0 skipped on a cold `make verify` |
| 4 quality review | quality-review | pass | 2 rounds: 3 blocking (invalid text reached PostgreSQL as a 500, artikel-13 docs described a shared test DB, 20 commits did not build with their own tests), fixed; re-review clean |

**Verified SHA:** `878a8c03843d50c39eafeb957c5abb61c3a61a57` (2026-10-23)

Every commit in `bab-2..bab-3` passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...` at its own snapshot.

### What the gate changed

- **Category filter:** `$1 IS NULL OR category_id IN (subquery)` hid the category from the planner, so a rare or empty category scanned every active product (24–68 ms at 100k). Rewritten as `= ANY(uuid[])` from `ListCategoryTreeIDs`; the same request now takes 0.01–0.04 ms on `products_active_category_newest_idx`.
- **Variant order:** UUIDv7 is random within a millisecond, so same-price sizes came back in any order. Added `position` (edited into the unreleased `000001`).
- **Invalid text:** `?q=%00` and NUL bytes in admin bodies became a 500 with an ERROR log. Text is now checked at the boundary (`httpapi.ValidText`) and SQLSTATE 22021 maps to 400 as a backstop.
- **Simplification for teaching:** the storefront went back to an INNER JOIN. The schema already forbids an active product without a sellable variant, so the LEFT JOIN, nullable variant columns and `withVariants` were removed.
- **Guards:** the seed and `migrate-down` refuse non-local hosts, including `host=` / `hostaddr=` query parameters.

## Decisions

- **Migrations:** embedded in the binary and applied by `api migrate`. Compose runs it as a one-shot `migrate` service before `api`; Railway runs it as `preDeployCommand`. The server never migrates itself.
- **Timestamps:** every UPDATE sets `updated_at = now()` in SQL; no triggers.
- **Admin routes:** `/v1/admin/products…` exist only when `APP_ENV=development` until Bab 4 adds role-based auth.
- **Railway healthcheck:** `/readyz` (now includes the `postgres` check); the Docker `HEALTHCHECK` stays on `/healthz`.
- **`plan_cache_mode=force_custom_plan`:** set by `database.Open` with a WARN if a pooler drops it; generic plans made optional-filter queries scan the whole table.

## Deferred

- **Bab 4:**
  - `cmd/seed` `requireLocal` refuses a socket-only URL such as `postgres:///goshop?host=/var/run/postgresql` (the empty URL host counts as non-local).
  - Delete a user's addresses when anonymising (from the Bab 1 ERD review).
- **Bab 5 (hard gate before checkout's stock decrement):**
  - `UpdateVariant` must check `AND version = @version` (0 rows → 409), and the admin GET/PUT must expose `version`.
  - Lock variants in id order before a stock restore.
- **Any chapter:** a JSON body with a raw invalid UTF-8 byte is accepted, because encoding/json replaces it with U+FFFD before validation. That is harmless, but worth one sentence in the contract.

## Articles → code

| Artikel | Topic | Commit |
|---|---|---|
| 01 | Schema: categories, products, variants, stock | `f63bb56` |
| 02 | Migrations with golang-migrate | `65945cb` |
| 03 | Seed data | `f61c210` |
| 04 | sqlc | `e911075` |
| 05 | Connection pool | `1f1dd6b` |
| 06 | Product CRUD end to end | `236b640` |
| 07 | Pagination: offset vs cursor | `48df0ea` |
| 08 | Filter and sort | `2cb2cfe` |
| 09 | Full-text search | `a77e192` |
| 10 | Transactions / unit of work | `fe606cb` |
| 11 | Indexes and EXPLAIN ANALYZE | `8f4c13e` |
| 12 | Soft delete and audit columns | `aa6a5d3` |
| 13 | Integration tests with real PostgreSQL | `a9994de` (docs), `141a572` (per-test database helper) |
| 14 | Reviewing queries with AI: N+1 and missing indexes | no code; uses the database-auditor findings above |
| 15 | Recap + challenge: featured products | conceptual |
