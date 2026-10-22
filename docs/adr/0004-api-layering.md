# 0004. Layer the API per feature: handler, service, repository

- Status: Accepted
- Date: 2026-10-22
- Chapter: Bab 2

## Context

`apps/api` starts in Bab 2 with one endpoint and grows to about thirty by Bab 20: catalog, auth, cart, checkout, payments, admin, search. The structure has to be easy to follow for a reader who copies code from one article at a time, and it has to survive later changes without a rewrite: in Bab 3 the in-memory category data is replaced by PostgreSQL, in Bab 4 auth arrives, in Bab 6 a worker binary shares the same code.

Two common shapes for a Go service:

- **Layered by technical role at the top**: `handlers/`, `services/`, `repositories/`, `models/`. Every feature is spread over four folders.
- **Clean / hexagonal architecture**: `domain/` (entities and ports), `usecase/` (interactors), `adapter/` (HTTP, SQL), `infrastructure/`, with interfaces declared for every boundary and dependencies pointing inward only.

## Decision

We will organise `apps/api` **per feature, with three layers inside each feature**:

```
apps/api/
├── cmd/api/main.go          # entry point: signals, exit code
└── internal/
    ├── app/                 # wiring: config → logger → repositories → services → handlers → server
    ├── config/              # env vars, validated at start
    ├── logging/             # logx setup, request-scoped logger
    ├── httpserver/          # http.Server timeouts, chi router, middleware order
    ├── httpapi/             # JSON responses, error mapping, timeout, query binding
    ├── health/              # /healthz, /readyz
    └── category/            # one feature
        ├── model.go         # the data the feature works with
        ├── repository.go    # storage (in memory in Bab 2, PostgreSQL from Bab 3)
        ├── service.go       # business rules
        └── handler.go       # HTTP: decode, validate, call the service, map errors
```

- **Dependencies point one way**: handler → service → repository. A handler never touches storage; a repository never knows about HTTP.
- **Interfaces live where they are used, and only where they buy something**: the service depends on a `Repository` interface, so Bab 3 swaps the in-memory repository for PostgreSQL without touching the service or the handler; the handler depends on a small interface of the service, so it can be tested with a fake.
- **Everything is in `internal/`**, so no other module can import it.
- Cross-cutting HTTP code (error body, JSON writer, middleware order) lives in `httpapi` and `httpserver`, once, not per feature.

## Alternatives considered

- **Layered folders at the top (`handlers/`, `services/` …)** — a change to one feature touches four distant folders, and every package imports every other feature's types. Grouping by feature keeps a feature's code, and its review, in one place.
- **Full clean architecture** — the separation is real, but for a course it costs more than it teaches: an interface and a mapping struct at every boundary, entity/DTO/row copies of the same data, and four or five packages before the first endpoint answers. Most GoShop features are "validate, apply a rule, store", where those extra layers carry no logic. The per-feature layering keeps the one property that matters (business rules do not depend on HTTP or SQL) with a third of the code. A feature that grows real domain logic (checkout in Bab 5) can still get its own `domain` types inside its folder.
- **One flat package** — fine for a single endpoint, but it does not show where the Bab 3 database code should go.

## Consequences

- Adding a feature means adding one folder with the same four files; readers learn the shape once.
- The service layer is thin for read-only endpoints like `GET /v1/categories` (it sorts and passes through). That is accepted: the layer is where rules go when they arrive, and it keeps handlers free of them.
- Features talk to each other through their services, never through another feature's repository. When two features need the same data, the dependency is explicit in the wiring in `internal/app`.
- No dependency-injection framework: wiring is plain Go in `internal/app`, so the startup order is readable top to bottom.
