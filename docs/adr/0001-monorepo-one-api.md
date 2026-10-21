# 0001. Use one monorepo and one API for every client

- Status: Accepted
- Date: 2026-10-21
- Chapter: Bab 1

## Context

GoShop has three clients: a web storefront, an admin dashboard and a mobile app for Android and iOS. They show the same products, prices, stock and orders. The project is built by a small team and taught in a course, where readers must be able to see how one change flows through backend and frontends.

## Decision

We will keep all code in one repository and serve all three clients from one Go API.

- `apps/api` (API and worker), `apps/web`, `apps/admin` and `apps/mobile` live side by side; shared TypeScript code goes in `packages/` (pnpm workspace).
- One contract, `api/openapi.yaml`, describes the API for every client.
- Admin-only behaviour is protected by the caller's role, not by a separate backend.
- Each app still has its own Dockerfile and Railway service, so they are deployed independently.

## Alternatives considered

- **One repository per app** — every API change would need coordinated PRs across repositories, and a course reader could not see a feature end to end in one diff.
- **A backend per client (backend-for-frontend)** — duplicates business rules such as price and stock checks, which would drift apart. Useful when clients are owned by different teams; we are one team.
- **A web framework that renders HTML and serves the API together** — does not serve the mobile app well, and couples the storefront's release cycle to the API.

## Consequences

- A feature is one branch and one PR across backend and frontends; `git diff bab-N..bab-M` shows it completely.
- The API must stay generic enough for three clients; client-specific needs become new endpoints, not forks.
- CI and the Makefile must only build what exists, since apps appear chapter by chapter.
- The repository grows larger; `.dockerignore` and per-app Dockerfiles keep image builds small.
