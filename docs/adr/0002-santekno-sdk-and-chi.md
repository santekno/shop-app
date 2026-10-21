# 0002. Build the API on santekno/sdk and chi

- Status: Accepted
- Date: 2026-10-21
- Chapter: Bab 1 (applied from Bab 2)

## Context

Every Go API needs the same plumbing: configuration from environment variables, structured logging, a consistent error format, validation, health checks, password hashing, tokens, rate limiting, IDs, money, storage, tracing. Writing all of it inside GoShop would bury the course's actual subject (building a shop) under infrastructure code, and every reader's project would end up with its own slightly different copy.

[santekno/sdk](https://github.com/santekno/sdk) is a public Go library that already provides these concerns as small packages (`configx`, `logx`, `errx`, `validx`, `healthx`, `hashx`, `jwtx`, `redisx`, `moneyx`, `uuidx`, `storagex`, `aix`, `tracex`, `metricx`, …) that work with plain `net/http`.

For routing we need path parameters, route groups and middleware, but no framework that replaces `net/http`.

## Decision

We will build `apps/api` on the standard library, the [chi](https://github.com/go-chi/chi) router, and santekno/sdk.

- Use the sdk package for every concern it covers. Do not reimplement it in GoShop.
- Pin the sdk to a released tag in `go.mod`, starting with **v0.2.0 (commit 97a873a, published on the Go module proxy 2026-10-22)**, always pinned explicitly as `@v0.2.0`, never `@latest`. Never use a `replace` directive, so readers get exactly the same code. The one exception is a module the sdk has not tagged yet, which is pinned by pseudo-version and listed in [`docs/sdk-gaps.md`](../sdk-gaps.md).
- HTTP middleware (`RequestID`, `Logger`, `Recovery`, `Tracing`, `JWTAuth`) comes from the sdk's `middleware/chi` package (v0.2.0), whose handlers are plain `func(http.Handler) http.Handler`.
- `errx` defines the errors (code, message, details, HTTP status) but writes no HTTP response. The body is written by `DefaultErrorWriter` in `middleware/chi`: `{"error":{"code":"…","message":"…","details":{…}}}`, with `details` omitted when the error has none. Handlers and chi's `NotFound`/`MethodNotAllowed` use the same writer.
- IDs come from `uuidx.NewV7`, and health probes from `healthx` with `HideErrors` set outside development (both v0.2.0).
- When the sdk lacks something, write a small adapter in GoShop and record it in [`docs/sdk-gaps.md`](../sdk-gaps.md), as a candidate for an upstream contribution.

## Alternatives considered

- **gin or echo** — full frameworks with their own context and handler types; code written for them does not move to plain `net/http`. chi handlers are standard handlers.
- **Standard library only (Go 1.22+ `ServeMux` patterns)** — good for routing, but has no route groups or per-group middleware, which the admin and auth routes need.
- **Write the plumbing ourselves** — more code to teach and test that is not about the shop.

## Consequences

- Handlers are standard `http.Handler`s, testable with `httptest`, and the knowledge transfers to any Go codebase.
- GoShop depends on the sdk's release cycle: a missing feature means an adapter now and an upstream change later.
- `middleware/chi`, `uuidx.NewV7` and the `healthx` fixes shipped in sdk v0.2.0 (commit 97a873a, published on the Go module proxy 2026-10-22), so Bab 2 pins `github.com/santekno/sdk v0.2.0` explicitly.
- Every error the API returns, from handlers or middleware, has the same shape, as specified in `api/openapi.yaml`.
