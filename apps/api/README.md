# GoShop API

The Go REST API behind the GoShop storefront, admin dashboard and mobile app. The contract is [`api/openapi.yaml`](../../api/openapi.yaml); the code must match it.

- Module: `github.com/santekno/shop-app/apps/api` (Go 1.26, see `.go-version`)
- Entry point: `cmd/api`
- Structure: one folder per feature under `internal/`, each with `model.go`, `repository.go`, `service.go` and `handler.go` ([ADR 0004](../../docs/adr/0004-api-layering.md))

```bash
cd apps/api
go build ./...
go run ./cmd/api
```
