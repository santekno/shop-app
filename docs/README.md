# GoShop documentation

Start with the [repository README](../README.md) to run the project, then read these in order.

## Product and design

| Document | What it answers |
|---|---|
| [prd.md](prd.md) | What GoShop is, for whom, and which features each chapter builds |
| [architecture.md](architecture.md) | How the clients, the API, the worker and the data stores fit together |
| [erd.md](erd.md) | The initial data model: users, catalog, orders |
| [`../api/openapi.yaml`](../api/openapi.yaml) | The API contract (OpenAPI 3.1), linted by `make lint-openapi` |
| [`../apps/api/SECURITY.md`](../apps/api/SECURITY.md) | What the API does about each risk of the OWASP API Security Top 10 (2023), its known limits, and a checklist for new endpoints |

## Working on the code

| Document | What it answers |
|---|---|
| [setup.md](setup.md) | Installing Go, Node.js, pnpm, Docker and the editor; `make doctor` |
| [configuration.md](configuration.md) | Every environment variable, dev vs staging vs prod, where secrets live |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Branch per chapter, commit format, merging fixes forward |
| [ai-rules.md](ai-rules.md) | When to use AI, the AI box in articles, what never goes into a prompt |
| [`../CLAUDE.md`](../CLAUDE.md) | The verified gate and the agents that run it |
| [sdk-gaps.md](sdk-gaps.md) | Concerns santekno/sdk does not cover yet, and GoShop's adapters |
| [web/README.md](web/README.md) | JS/TS for Go developers: the Bab 7 concepts mapped to files in `packages/shared` and `apps/web` |
| [`../apps/web/README.md`](../apps/web/README.md) | Running, building and configuring the storefront (`VITE_API_URL`, the container) |

## Chapter records

| Document | What it answers |
|---|---|
| [bab-template.md](bab-template.md) | Template for `bab-N.md` |
| `bab-N.md` | Per chapter: the verified commit, gate results, and which files each article added |

## Architecture decision records

An ADR records one significant decision: the context, the decision and its consequences. ADRs are never edited after they are accepted; a new ADR supersedes an old one. Copy [the template](adr/0000-template.md) and take the next number.

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-monorepo-one-api.md) | One monorepo, one API for every client | Accepted |
| [0002](adr/0002-santekno-sdk-and-chi.md) | Build the API on santekno/sdk and chi | Accepted |
| [0003](adr/0003-seaweedfs-local-s3.md) | SeaweedFS as local S3 storage | Accepted |
| [0004](adr/0004-api-layering.md) | Layer the API per feature: handler, service, repository | Accepted |
| [0005](adr/0005-auth-tokens.md) | Authenticate with a short-lived JWT and a rotating refresh token | Accepted |
| [0006](adr/0006-cart-checkout-orders.md) | Keep carts in PostgreSQL and create an order in one guarded transaction | Accepted |
| [0007](adr/0007-payments-uploads-worker.md) | Take payments through Midtrans Snap, upload images straight to S3, and run side effects on an Asynq worker | Accepted |
| [0008](adr/0008-web-session-cookie.md) | Give the browser its refresh token in an httpOnly cookie on dedicated web endpoints | Accepted |
