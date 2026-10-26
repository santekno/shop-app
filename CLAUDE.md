# CLAUDE.md

GoShop is the companion code for the Santekno Fullstack Course. Each course chapter is a cumulative branch `bab-N`; the articles are written **from** this code, so the code must be correct before any article exists.

## Chapter workflow (you are the orchestrator)

Start sessions for code work in this directory so the agents in `.claude/agents/` load. For chapter N, branch `bab-N` from `bab-(N-1)` and run the pipeline in order. Every stage runs on the same commit.

| Stage | Agent | Done when |
|---|---|---|
| 0 | `backend-engineer` / `frontend-engineer` / `react-native-engineer` | the chapter's features exist; `make build lint docker-build` passes |
| 1 | `test-engineer` | `make test-unit` passes (Go ≥ 80%, TS ≥ 70% coverage) |
| 2 | `database-auditor` | no blocking finding, or "no SQL change" recorded |
| 3 | `integration-engineer` | `make test-integration` passes with no skipped tests; `make up` health checks return 200 |
| 4 | `quality-review` | no blocking finding |

Any failure goes back to the agent that owns the code, then stages 0–4 run again. When stage 4 passes, record the verified SHA and every stage result in `docs/bab-N.md` (template: `docs/bab-template.md`). Only then may articles be written.

The `make` targets come from the `Makefile`, which arrives in Bab 1 artikel-12.

## Rules

- Commits: conventional, scoped to the article they implement — `feat(bab-3/artikel-04): add sqlc product queries`.
- Toolchain: Go 1.26+ (`.go-version`), Node.js 24 LTS (`.nvmrc`), pnpm 10.
- Backend: use `github.com/santekno/sdk` for every concern it covers, pinned to a released tag, never `replace`. Gaps, and the one module that has no tag yet (`ratelimitx`), are recorded in `docs/sdk-gaps.md` (arrives in Bab 1 artikel-14).
- Every deployable service has its own Dockerfile (repo root as build context, multi-stage, non-root, config from env, listens on `$PORT`) and `deploy/railway/<service>.json`.
- The mobile app builds for Android and iOS through `apps/mobile/eas.json`.
- No real secrets anywhere: env vars only, placeholders in `.env.example`, Midtrans sandbox only. `make scan` (arrives in Bab 1 artikel-12) must pass.
- Agents edit only the paths they own (see the table below). A change needed in someone else's path goes into the report for that owner.

## Ownership

Every path has exactly one owner. When patterns overlap, the more specific row wins (for example, `*_test.go` inside `apps/api` belongs to test-engineer).

| Path | Owner |
|---|---|
| `apps/api/**` (except tests below), `api/openapi.yaml`, `redocly.yaml`, `.redocly.lint-ignore.yaml` | backend-engineer |
| `Makefile`, `scripts/**` (except `scripts/go-coverage.sh`) | backend-engineer |
| `docker-compose.yml`: the dependency services (`postgres`, `redis`, `storage`) and the `api`/`worker` services | backend-engineer |
| `deploy/seaweedfs/**`, `deploy/railway/api.json`, `deploy/railway/worker.json` | backend-engineer |
| `.env.example`, `.dockerignore`, `.go-version` | backend-engineer |
| `docs/architecture.md`, `docs/erd.md`, `docs/configuration.md`, `docs/sdk-gaps.md`, `docs/adr/**` | backend-engineer |
| `apps/web/**`, `apps/admin/**` (except tests), `packages/**`, `docs/web/**` | frontend-engineer |
| `docker-compose.yml`: the `web`/`admin` services; `deploy/railway/web.json`, `deploy/railway/admin.json` | frontend-engineer |
| root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (except its `e2e` entry), `.nvmrc` | frontend-engineer |
| `apps/mobile/**` (except tests and `.maestro/`) | react-native-engineer |
| `**/*_test.go` (except `apps/api/tests/**`), `**/*.test.ts(x)`, test setup and coverage config, `scripts/go-coverage.sh` | test-engineer |
| `apps/api/tests/**`, `e2e/**`, the `e2e` entry in `pnpm-workspace.yaml`, `apps/mobile/.maestro/**`, `.github/workflows/**` | integration-engineer |
| `CLAUDE.md`, `.claude/agents/**`, `CONTRIBUTING.md`, `.github/**` (except `workflows/`), `README.md`, `apps/README.md`, `docs/README.md`, `docs/prd.md`, `docs/ai-rules.md`, `docs/setup.md`, `docs/bab-*.md` | orchestrator (main session) |
| repository skeleton: `.gitignore`, `.editorconfig`, `LICENSE`, `.gitkeep` files | orchestrator (main session) |

database-auditor and quality-review own no paths; they only report.

`pnpm-lock.yaml` changes whenever any workspace's dependencies change. Agents other than frontend-engineer may let `pnpm install` update it for their own dependencies, but they list the lockfile change in their report, and frontend-engineer owns resolving conflicts in it.

Bab 1 was produced by stage 0 (backend-engineer) under orchestrator authority for the orchestrator-owned files it touched.
