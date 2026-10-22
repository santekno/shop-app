# GoShop API

The Go REST API behind the GoShop storefront, admin dashboard and mobile app. The contract is [`api/openapi.yaml`](../../api/openapi.yaml); the code must match it.

- Module: `github.com/santekno/shop-app/apps/api` (Go 1.26, see `.go-version`)
- Entry point: `cmd/api` (`api` serves; `api healthcheck` probes a running API, for Docker)
- Structure: one folder per feature under `internal/`, each with `model.go`, `repository.go`, `service.go` and `handler.go` ([ADR 0004](../../docs/adr/0004-api-layering.md)); the wiring is plain Go in `internal/app`

## Endpoints (Bab 2)

| Method | Path | What |
|---|---|---|
| GET | `/healthz` | Liveness: 200 while the process runs |
| GET | `/readyz` | Readiness: 503 while the server drains during shutdown (dependency checks arrive in Bab 3) |
| GET | `/v1/categories` | Every category, top-level first, sorted by name. Served from an in-memory repository with seed data; IDs are new UUIDv7s on every start |

`GET /v1/products` and `GET /v1/products/{slug}` are in the contract but arrive in Bab 3 with PostgreSQL; until then they answer the JSON 404 for unknown routes. Every error, including unknown routes (404 `NOT_FOUND`) and wrong methods (405 `METHOD_NOT_ALLOWED`), uses the body `{"error":{"code","message","details?"}}`.

## Run it

All settings come from environment variables ([docs/configuration.md](../../docs/configuration.md)). `APP_ENV` is required; everything else has a default.

```bash
# from the repository root
make up                       # the API in Docker on 127.0.0.1:8080, next to Postgres, Redis, SeaweedFS
curl -i localhost:8080/v1/categories

# or directly with Go
cd apps/api
APP_ENV=development go run ./cmd/api
```

### Hot reload

```bash
make dev-api                  # from the repository root
```

`make dev-api` reads `.env` when it exists (`cp .env.example .env`), defaults `APP_ENV` to `development`, and runs [Air](https://github.com/air-verse/air) with `apps/api/.air.toml`: every saved `.go` file rebuilds and restarts the API, and a change that does not compile keeps the last good server running. The old server gets SIGINT, so it shuts down gracefully, exactly as in production.

Nothing needs installing: the first run builds the pinned Air version (`AIR_VERSION` in the `Makefile`) into `apps/api/bin/` (gitignored). To use your own copy instead: `go install github.com/air-verse/air@v1.67.4` and run `air` inside `apps/api`.

The Docker `api` service from `make up` also uses port 8080. Stop it first (`docker compose stop api`) or pick another port: `APP_PORT=8081 make dev-api`.

## Checks

```bash
make build lint docker-build  # compile, go vet + golangci-lint (apps/api/.golangci.yml), images
make test-unit                # unit tests with the coverage threshold
```

`make lint` builds the pinned golangci-lint (`GOLANGCI_VERSION` in the `Makefile`) with the module's Go toolchain on first use, because a golangci-lint built with an older Go refuses to lint a `go 1.26` module.

## Validation for later chapters

`httpapi.Validator.BindQuery` fills a struct from the URL query (`query:"name"` tags; string, int, int64, bool) and validates it with `validx` (`validate:"…"` tags). Failures become one 400 `VALIDATION_FAILED` with a message per field, as in the contract. Its first consumer is `GET /v1/products` in Bab 3: `GET /v1/categories` has no parameters.

`Validator.Struct` (for request bodies, from Bab 4) names top-level fields by their `json` tag and builds their message from their `validate` tag. A field inside a nested struct is reported by its Go name (`City`), with a message from the failed rule alone, and never borrows the tags of a top-level field with the same name: a documented limitation until a chapter sends a nested body (see `docs/sdk-gaps.md`).
