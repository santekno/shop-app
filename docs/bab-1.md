# Bab 1 — Kickoff GoShop: arsitektur & workflow

Branch: `bab-1` (from `main`, the initial commit)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | `make build lint docker-build`; no app code yet, OpenAPI lint via Redocly 2.66.1 |
| 1 unit tests | test-engineer | pass (n/a) | Bab 1 adds no application code; the gate scripts carry their own `--self-test` |
| 2 DB audit | database-auditor | pass, no SQL change | ERD design review over 3 rounds: 2 + 1 blocking findings fixed (order line snapshots, archived variants, FK on-delete rules, checkout guard on product status); converged at 0 blocking |
| 3 integration | integration-engineer | pass | Postgres (pgvector 0.8.7), Redis and SeaweedFS healthy on 127.0.0.1; `make test-integration` fails on skipped tests |
| 4 quality review | quality-review | pass | 2 rounds: 5 blocking fixed (sdk claims, skip-proof integration gate, path ownership, Node 24 / Go 1.26 baseline, ports on 127.0.0.1); final delta pass clean |

**Verified SHA:** `e74b8557e90762416adaa697ef02764814a13771` (2026-10-22)

Toolchain at verification: Node 24.22.1, Go via `GOTOOLCHAIN=auto` (1.26), santekno/sdk v0.2.0 (`97a873a`).

### Deferred to the start of Bab 2

From the final quality review (all advice):
- add a `chmod 000` case to the `secret-scan.sh` self-test, so a grep read error (exit 2) is covered
- run `scripts/no-skips.sh --self-test` from `make verify`
- fail `no-skips.sh` when `tee` fails (`PIPESTATUS[1]`)
- refresh the sdk wording to "released 2026-10-22 (tag v0.2.0, commit 97a873a)" in `docs/sdk-gaps.md`, ADR 0002 and `backend-engineer.md`

From the ERD review, for Bab 3/5:
- lock variants in id order before a stock restore
- delete a user's addresses when anonymising
- document that `FOR UPDATE OF v` does not lock the product row

## Articles → code

| Artikel | Title | Files | Commit |
|---|---|---|---|
| 01 | Kenalan dengan GoShop | conceptual | — |
| 02 | Arsitektur fullstack | `docs/architecture.md` | `ca54911` |
| 03 | Menyusun monorepo | `README.md`, `apps/README.md`, `package.json`, `pnpm-workspace.yaml`, `.gitkeep` layout | `b8b4acf` |
| 04 | Setup Go, Node.js, pnpm, dan editor | `.go-version`, `.nvmrc`, `docs/setup.md`, `scripts/check-tools.sh` | `0a75b9f` |
| 05 | Docker Compose | `docker-compose.yml`, `deploy/seaweedfs/s3.json`, `.dockerignore` | `b7efbea` |
| 06 | Git workflow | `CONTRIBUTING.md`, `.github/pull_request_template.md` | `6c36dbc` |
| 07 | Workflow coding dengan AI | `CLAUDE.md`, `.claude/agents/*.md` | `6f43e76` |
| 08 | Aturan main pakai AI | `docs/ai-rules.md` | `882a358` |
| 09 | PRD GoShop | `docs/prd.md` | `c1f7f65` |
| 10 | ERD awal | `docs/erd.md` | `12865f4` |
| 11 | Kontrak API OpenAPI | `api/openapi.yaml`, `redocly.yaml`, `.redocly.lint-ignore.yaml` | `4d6aead` |
| 12 | Makefile dan task runner | `Makefile`, `scripts/go-coverage.sh`, `scripts/no-skips.sh`, `scripts/secret-scan.sh` | `443c54e` |
| 13 | Environment config | `.env.example`, `docs/configuration.md` | `3122067` |
| 14 | Struktur dokumentasi | `docs/README.md`, `docs/adr/*`, `docs/bab-template.md`, `docs/sdk-gaps.md` | `e74b855` |
| 15 | Rangkuman dan tantangan | conceptual | — |
