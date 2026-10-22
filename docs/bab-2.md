# Bab 2 — Fondasi REST API dengan Go

Branch: `bab-2` (from `bab-1` @ `9ade893`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | chi + santekno/sdk v0.2.0; go1.26.10 (`toolchain` directive and Docker image); golangci-lint v2.15.0 built by make, integration-tagged files included |
| 1 unit tests | test-engineer | pass | 99.4% coverage; every measured package must have tests (`go-coverage.sh` no longer needs `covdata`, which GOTOOLCHAIN-downloaded toolchains lack); mutation-checked |
| 2 DB audit | database-auditor | pass, no SQL change | no database in Bab 2 |
| 3 integration | integration-engineer | pass | real HTTP against the wired app plus the compose `api` container; contract-driven field checks; 387 passed, 0 skipped on a cold `make verify` |
| 4 quality review | quality-review | _pending re-review_ | first pass: 1 blocking (ownership record, below) and 11 advice items, applied |

**Verified SHA:** _recorded after stage 4 passes_

### Bugs the gate caught and fixed

- `Validator.Struct` reported nested fields under an empty key (stage 1). A reflection-based fix then broke inline root structs (stage 1). The review judged the result too heavy for Bab 2 (stage 4). The flat version then let a nested field borrow a top-level field's json name and rules (stage 1). Final shape: top-level fields use their json tag and rules; nested fields keep their Go name with messages from the failing tag. Limitations are pinned by tests and recorded in `docs/sdk-gaps.md`.
- `HEAD` on GET routes answered 405 (stage 3), then cross-origin `HEAD` got no CORS headers (stage 3).

## Orchestrator decisions

- **Makefile edit by integration-engineer** (`build(bab-2): start the api container in make test-integration and test it`): authorised by the orchestrator. `test-integration` builds and starts the `api` service and exports `GOSHOP_API_URL`; backend-engineer keeps ownership of the Makefile and accepts the change as is.
- **Orchestrator-owned files edited by agents under orchestrator authority:** `docs/setup.md`, `scripts/check-tools.sh` (backend-engineer, `chore(bab-2): document that make provides golangci-lint and air`), `.claude/agents/backend-engineer.md` (backend-engineer in `chore(bab-2): refresh santekno/sdk v0.2.0 release wording`; orchestrator in `chore(bab-2): point backend-engineer at internal/app for wiring`).
- **Validator scope (review A3):** `Struct` stays flat for teaching; nested json paths wait for a validx `RegisterTagNameFunc` option. `BindQuery` stays; its first consumer is `GET /v1/products` in Bab 3.
- **Package name:** the local `internal/httpx` became `internal/httpapi` so it does not shadow `github.com/santekno/sdk/httpx`.
- **Tracing** is removed until Bab 19; the global tracer would be a no-op.

## Articles → code

Commits are on `bab-2`; `test(…)` commits for an article carry its unit and integration tests.

| Artikel | Topic | Production files | Notes |
|---|---|---|---|
| 01 | Layered vs clean architecture | `docs/adr/0004-api-layering.md`, `apps/api/{go.mod,cmd/api/main.go,.golangci.yml,README.md}` | |
| 02 | net/http + chi | `internal/httpserver/{server.go,router.go}` | |
| 03 | Handler, service, repository | `internal/category/*` (in-memory repository) | Postgres arrives in Bab 3 |
| 04 | Config from env | `internal/config/config.go` | |
| 05 | Structured logging | `internal/logging/logging.go` | |
| 06 | Middleware | `internal/httpserver/router.go`, `internal/httpapi/timeout.go` | request ID, logger, recovery, CORS, GetHead, timeout |
| 07 | Consistent JSON + errors | `internal/httpapi/{errors,respond}.go`, router NotFound/405 | |
| 08 | Validation | `internal/httpapi/validate.go` | no Bab 2 route has input; first caller in Bab 3 |
| 09 | Graceful shutdown | `internal/httpserver/serve.go`, `internal/health/readiness.go` | |
| 10 | Health and readiness | `internal/health/health.go`, probes outside the request timeout | |
| 11 | Manual DI | `internal/app/app.go`, thin `cmd/api/main.go` | |
| — | Dockerfile, Railway, compose `api` (`build(bab-2)`) | `apps/api/Dockerfile`, `internal/app/probe.go`, `deploy/railway/api.json` | the `api healthcheck` subcommand belongs to artikel 10/11's story (distroless has no curl) |
| 12 | Handler tests with httptest | tests only | `test(bab-2/artikel-12)` also holds the `go-coverage.sh` gate change, which is tooling, not article content |
| 13 | Hot reload with Air | `apps/api/.air.toml`, `make dev-api` | |
| 14 | API docs from OpenAPI | `make docs-api` | |
| 15 | Recap + challenge | conceptual | the `/version` endpoint is the readers' challenge |
