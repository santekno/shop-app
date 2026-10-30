# Bab 12 — Dashboard admin & testing frontend

Branch: `bab-12` (from `bab-11` @ `32bceac3`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | frontend-engineer, backend-engineer | pass | frontend-engineer, `apps/admin` (new, a Vite SPA served by Caddy): artikel 01 the shell (sidebar, header, breadcrumb, its own web session, a staff-only gate), 02 a server-side TanStack Table with its state in the URL, 03 a three-step product form, 04 photos uploaded straight to storage through presigned URLs with local previews, 05 stock and variants with a three-way merge after a 409, 06 the order queue, status changes and a printable shipping label, 07 a Recharts sales report, 08 one permission table for the UI, 09 an SSE client for live order events, 14 measured re-render fixes, 15 the recap and the CSV challenge (README only). backend-engineer: `GET /v1/admin/products` (offset pages, filters, sorts), cancel for admins only, `GET /v1/admin/events` (SSE fed by Redis pub/sub from the outbox, ADR 0009), the dashboard's own refresh cookie (`X-GoShop-Client: admin`, ADR 0008), `make seed-admin role=seller`, a product version (migration `000021`), `POST …/variants/{id}/stock-adjustments`, `409 VARIANT_ARCHIVED`, `low_stock_threshold` on the table. `make build lint` passed after every article; the agents built only their own image (api, admin), and every image was built together in the cold gate |
| 1 unit tests | test-engineer | pass | Go: total coverage 97.7%, golangci-lint 0 issues; tests for every new handler, query wrapper, the SSE handler on a real server, the outbox fan-out, the admin cookie and the seed role. TypeScript: Vitest + Testing Library + MSW 3 set up for `apps/admin` (artikel 10, 11); 1446 tests in `apps/admin`, 533 in `packages/shared`, 1216 in `apps/web`, every file at or above 70%. Every test file was mutation-checked against its first draft (`docs/testing-ai-review.md`, artikel 13). Two production bugs found and fixed (What the gate changed) |
| 2 DB audit | database-auditor | pass | the product table's queries (one batched thumbnail query per page, no N+1; offset bounded), migration `000021` (metadata-only column, reversible, checked up/down/up), the product version compared under the product's row lock before any variant lock, the stock adjustment as one guarded single-row `UPDATE` (no lock cycle with checkouts, checked with two sessions), the outbox fan-out's at-least-once delivery. Two should-fix items fixed (What the gate changed) |
| 3 integration | integration-engineer | pass | Go integration against PostgreSQL, Redis and SeaweedFS: 1216 top-level tests (4596 with subtests), 0 skipped; new: seller cancel refused, both web sessions in one cookie jar, the product table on real data, the product version and stock adjustments (incl. a race with checkouts), migration `000021` down/up, an order event from the outbox through Redis to the SSE stream. Playwright: 142 passed, 0 skipped, 12 of them new for the dashboard — the flagship flow: a buyer checks out on the storefront and pays, the open dashboard shows the toast and the badge, the admin processes, ships with a resi and prints the label, the buyer sees "Dikirim"; plus roles, the product table and form with a real photo upload to SeaweedFS, quick stock changes, the report, and the admin container. Health checks 200 (api, web, admin) |
| 4 quality review | quality-review | pass | four reviewers (backend; admin products; the rest of the admin; tests and the artikel-13 record). Round 1: 2 slices blocked — the conflict review lost the keyboard focus when it finished loading, and an MSW request no handler answered did not fail the test (the record also overstated its miss rate). Fixed with the rest of the advice in `d71555d1..8e227c4f`; round 2 passed all slices; round 3 reviewed the later focus fixes and build change and passed |

**Verified SHA:** `81d6297d55a1ac9dcc53de7929b4e93e09c7e459` (2026-10-30). Stage 2 audited the backend as of `55d9af61`, stage 3 ran on `9b3ed434` and stage 4 on `253cb54f` (rounds 2 and 3 on `8e227c4f` and `a38b0f39`); everything after them is the fixes they asked for, and the cold gate ran on the whole. The record's own commits change no code.

`make verify` ran from a cold stack (`docker compose down -v` first, its own Compose project on host ports 2xxxx, with the admin service on 25174) at the verified SHA and passed every stage in 1127 s: build, lint, `docker-build` of every image, Go unit coverage 97.7%; 533 tests in `packages/shared`, 1446 in `apps/admin` (106 files) and 1216 in `apps/web` (130 files); 1216 top-level Go tests in the integration run (4596 with subtests) and 142 Playwright tests passed, 0 skipped; health checks 200 for api, web and admin; `make scan` clean. The Go integration suite ran again under `-race` (`-timeout 60m`) at the same SHA: 29 packages, clean. The first cold run, at `a38b0f39` plus the stage-3 commits, stopped at `make lint` on two findings in the new integration tests (`81d6297d`).

**Per-commit, read honestly.** The chapter was built by several agents in parallel worktrees and cherry-picked onto `bab-12`, and the tests of each article came in stage 1, after all of stage 0. So most `feat` commits do not pass the unit tests at their own snapshot, and some break tests until a later commit: `2de38bd9` (cancel for admins) fails the order handler test until `4970add1`; `ff3933fe` (the product version) makes `PUT` require `version`, which the dashboard sends only from `55d9af61`, so the edit form saves 400 between them. The per-commit loop was not run for this chapter. Commit scopes follow the article whose code a commit mainly changes; `fce7f137` and `a38b0f39` are scoped artikel 05 but touch the retry buttons of artikel 02–04, 06, 07 and 09 too.

### What the gate changed

- **Stage 0, a product save archived another admin's new variant** (artikel 05, found by frontend-engineer while building the merge): `PUT /v1/admin/products/{id}` archives every sellable variant the body leaves out, and a form loaded before another admin added a variant left it out, so the save archived it without a 409, and archiving cannot be undone. Products now have their own version (`ff3933fe`, migration `000021`): a stale save is `409 VERSION_CONFLICT` with `details.product_id`, and the dashboard merges it (`55d9af61`). The same pass replaced the dashboard's GET-then-PUT stock change by an atomic `stock-adjustments` endpoint (`19052077`) and the 400 for an archived variant by `409 VARIANT_ARCHIVED` (`c38c7984`).
- **Stage 0, a URL-state flicker** (artikel 02, `b1a9bb4c`): filters bound to the URL snapped back for a frame, because React Router navigates in a transition.
- **Stage 0, "Muat lebih banyak" dropped by a live event** (artikel 09, found while measuring artikel 14, `4f48f9ea`): an event's refetch cancelled the next page on its way, and the queue fell back to page 1; and the reverse, a press during a refetch cancelled the refetch.
- **Stage 1, two URL-state updates in one event kept only the last** (artikel 02/07, `7c7f9d61`): React Router's `setSearchParams(fn)` hands `fn` the params of the render that created it.
- **Stage 1, an inactive order query stayed fresh after a live event** (artikel 09, `ec11b315`): a detail page reopened within `staleTime` showed the order from before the event.
- **Stage 2:** the low-stock filter ran the per-product aggregate for every product (100k buffers at 20k products) — now an `EXISTS` (`7311064e`); the stock adjustment's cap also refused decreases after a cancellation had restored stock above 1,000,000 — now only increases are capped (`2750bc92`).
- **Stage 4, blocking:** the conflict review's heading was replaced when the review finished loading, so the focus fell to `<body>` (`3c8d0299`; the test now holds the answer back 100 ms, because MSW answered before React rendered the loading state); MSW's `onUnhandledFrame: "error"` failed only the request, not the test, and three tests relied on an unanswered refresh (`cafeaa0a`); the artikel-13 record counted equivalent mutants as misses (`d9c11a04`, `f83bd58e`).
- **Stage 4, should-fix and advice:** a refetch on its way could overwrite a just-saved stock or photo (`cancelQueries` first, `d71555d1`, `3c8d0299`); a storage refusal retried the same presigned URL (`d71555d1`); a failed background refetch replaced a valid report or product list with an error card (`ada39c18`, `a3afae89`); "Coba lagi" did nothing while an attempt was on its way (`9c065cc0`); a status change whose answer was lost or failed after the API committed was reported as "changed by someone else" — now "uncertain", refetched (`25ab3fc1`, `6cbe164e`); the live feed copied an order event's fields unchecked (`08275204`); the ReadTimeout comment and ADR 0009 overstated what the server's read deadline does to a stream (`8e227c4f`); 13 retry buttons dropped the focus to `<body>` when they disappeared (`fce7f137`).
- **Stage 3 / cold gate:** `make test-integration` did not start the admin service, the Go integration package needs `-timeout 30m` under load, and test-only Go files are now outside the images' build context (`489f46f9`); a Bab 11 spec read the guest cart's token before it was written (`b0c1afaa`); two lint findings in the new integration tests (`81d6297d`).

### After the gate

Writing the articles against a demo stack built from the verified SHA (its own Compose project, seeded with the example catalog, an admin and a seller) found no code bug. It found two README statements that did not match the code; both are fixed in `e4f48ea4` (docs only, so the verified SHA stands):

- artikel 02's "flow of one click" said the first click on "Harga mulai" sorts ascending (`arah=naik`); the price column has `sortDescFirst: true`, so it sorts from the highest price and writes `?urut=harga` (measured in Chromium);
- artikel 08 said the proactive refresh replaces a token 30 seconds early; that refresh runs only before a request, so an idle tab gets its new token when the event stream ends with `token_expired` (measured: the role-change notice appeared about 270 ms after the stream's end). The 15-minute bound holds either way.

Operational note for future demo stacks: login is limited to 20 attempts per IP and 5 per email per 15 minutes, so writers sharing one stack and one seller/admin account should reuse a session (the refresh cookie) rather than log in per script.

## Decisions

The dashboard's decisions are in `apps/admin/README.md` (one section per article); the API's in `docs/adr/0008` (Bab 12 section), `docs/adr/0009`, `docs/adr/0006` (product version, lock order), `docs/configuration.md` and the OpenAPI descriptions.

- **Only an admin cancels an order** (author decision; answers `docs/prd.md` open question 5). Sellers process, ship and complete. The UI hides what a role cannot do; the API refuses it.
- **Live events over SSE, read with `fetch`** (author decision): `EventSource` cannot send `Authorization`; the stream ends with `event: end` on token expiry or shutdown, the client refreshes and reconnects, and refetches after every connect (no replay).
- **The dashboard has its own refresh cookie** (`goshop_admin_refresh`, chosen by `X-GoShop-Client: admin`): the storefront and the dashboard no longer replace each other's session.
- **Offset pages for the admin table, cursors for queues:** a table jumps to page N and sorts by column; a queue that changes while it is read keeps its place with a cursor.
- **The dashboard is a Vite SPA behind Caddy**, as the storefront was in Bab 7–10: the API origin is baked in at build time, the image and upload origins are read by Caddy at start; the CSP allows `blob:` in `img-src` only (previews). Recharts writes styles through the CSSOM, so `style-src 'self'` needed no change.
- **Tests:** Vitest + Testing Library + MSW 3 at the network level, with handlers typed from the contract; an unanswered request fails the test. React Compiler is not enabled; the artikel-14 fixes are two measured `memo`s.
- **New dependencies:** `@tanstack/react-table` 9.3.1, `recharts` 3.10.1 (+ `react-is`), `msw` 3.0.3, `@testing-library/jest-dom` 7.0.1 (and the other Testing Library packages already used by the storefront). No new Go dependency; sdk stays at v0.2.0.

## Notes

- **Contract:** `api/openapi.yaml` adds the admin product table, the stock adjustment, the event stream and `AdminOrderEvent`, `version` on `AdminProduct`, the codes `TOO_MANY_STREAMS`, `VARIANT_ARCHIVED`, `STOCK_OUT_OF_RANGE`, `STOCK_CHANGED`, `GoShopClientHeader: web|admin`; cancel is admin-only. `schema.gen.ts` regenerated; `gen-types-check` passes.
- **Ownership exceptions:** test-engineer pinned `msw` and `@testing-library/jest-dom` in the `pnpm-workspace.yaml` catalog (frontend-engineer's file), as the parallel rules required for new dependencies; recorded here as a sanctioned exception. The orchestrator resolved cherry-pick conflicts in `apps/admin/README.md`, `packages/shared/src/api/types.ts` and `index.ts`, and one semantic conflict (`SessionProvider` lacked `refreshAfterForbidden` after artikel 08 and 09 met, fixed inside `853c66a8`). No test agent changed production behaviour.
- **Test isolation:** stage 3 ran on its own Compose project (`goshop-it12`, host ports 2xxxx); the cold gate on `goshop-gate`.
- **Load:** the shared machine ran at a load average of 15–54 during stages 1 and 3, which is why Vitest's per-test limit is 20 s and Testing Library's async limit 10 s (justified by the stage-4 tests review: the slowest test takes 2.2 s alone) and the Go integration package has 30 minutes.

## Deferred

- **No idempotency key on product create:** a POST that times out after the server created the product is retried into `SLUG_TAKEN`.
- **No `PATCH` for a photo's alt text or position:** the dashboard sends `alt: ""`, and the first ready photo is the main one.
- **Orphaned pending photos** hold one of the ten slots until the daily cleanup.
- **A demoted admin keeps admin rights until the token refreshes** (≤ 15 min): the role is in the token. Revoking sessions on a role change needs a role-change API first.
- **`APP_ADMIN_ORIGINS`:** the client header is a CSRF defence, not authorisation, so an XSS on the storefront could refresh the dashboard's session in the same browser (as before, with the shared cookie). ADR 0008 records it.
- **The SSE stream cap is per API instance** (5 per account), kept in memory (ADR 0009).
- **The product table's cost grows with the catalog** (about 3 ms per 1,000 products, measured at 20k); `pg_trgm` for the search and paging before the aggregate are the next steps.
- **The edit page's badges use a hand-kept threshold:** `GET /v1/admin/products/{id}` carries no `low_stock_threshold`.
- **`loadLatest` during a quick stock change** costs one more 409 round (nothing is overwritten); **"(oleh admin lain)"** may be the same seller in another tab — both in README artikel 05.
- **Pressing a photo tile's "Coba lagi" twice quickly** cancels the upload it just retried.
- **Accessibility advice from stage 4 round 3:** the connection status line is not a live region, so "Langsung" is never announced; the "may be behind" lines move focus to the `<h1>` even when the refetch fails again; check the focus rings of the headings in Safari.
- **Tests:** `make test-unit` could cap workspace or Vitest concurrency so the raised time limits come back down; MSW per-request answers are not body-typed (the typed helpers are).
- **The profiling harness of artikel 14** is not in the repo (about 400 lines with Playwright); the README labels the numbers as one machine's.
- **The CSV export of the report:** the artikel-15 challenge (`apps/admin/README.md`); there is deliberately no export.

## Articles → code

| Artikel | Topic | feat / fix | tests (unit, integration, e2e) |
|---|---|---|---|
| 01 | The dashboard layout | `dd85bc47`, `f907ccd1` (CORS), `8dcfe783`, `c3df3e15` (API cookie), `f88ddcd8`, `9620d337` (docs) | `fee0ded4`, `7ea78ec7`, `6310a868`; Go integration `8246c914` |
| 02 | TanStack Table, server-side | `cb25b2d5` (API), `568954e7`, `b1a9bb4c`, `cc586f8c` (API), `7311064e` (API), `7c7f9d61`, `a3afae89`, `e4f48ea4` (README) | `4243e141`, `ae9ed90e`, `4576e0f0`, `9a7bfcb8`, `0a90eab0`, `f72ac61e`; Go integration `2b892a44`; e2e `dc6cc779` |
| 03 | The multi-step product form | `2ac3ea7c` | `2c69ff30`, `099bf401`, `0d0c07e1`; e2e `dc6cc779` |
| 04 | Photo upload with presigned URLs | `2d154fe7`, `9fefff35` (docs), `d71555d1` | `442b4a92`, `c9840333`; e2e `dc6cc779` |
| 05 | Stock and variants | `20e53c2e`, `ff3933fe`, `c38c7984`, `19052077` (API), `55d9af61`, `2750bc92` (API), `3c8d0299`, `46f01839`, `3f98683f` (docs), `fce7f137` | `b8b50c42`, `9b3ed434`, `cd626e3a`, `3b72903b`, `669cd327`, `c1cbe23c`, `a38b0f39`; Go integration `8eb07da4`, `e2b4f54a`; e2e `dc6cc779` |
| 06 | Orders: status and the shipping label | `141bca7f`, `25ab3fc1`, `6cbe164e` | `12637d29`; e2e `dc6cc779` |
| 07 | The sales chart with Recharts | `1f8715aa`, `ada39c18` | `735d2a10`; e2e `dc6cc779` |
| 08 | Role-based UI | `2de38bd9` (API), `9d4a222d` (seed), `314e8d3e` (docs), `d0700b2c` | `4970add1`; Go integration `fa3cc648`; e2e `dc6cc779` |
| 09 | Live new-order notifications (SSE) | `a637d601` (API), `93ab5729`, `853c66a8`, `749e7c0b`, `4f48f9ea`, `ec11b315`, `9c065cc0`, `08275204` (API), `8e227c4f` (docs) | `d01b2ff5`, `80940554`, `f273adeb`, `2da01695`, `661c0455`; Go integration `308bb3fd`, `81d6297d`; e2e `dc6cc779` |
| 10 | Unit tests with Vitest and Testing Library | — (test setup) | `6310a868`, `c2a5de55`, `cd0afbc0`, `c9c5efda`, `9671dcf6` |
| 11 | Mocking the API with MSW | — (test setup) | `54196578`, `5dfe1bdd`, `cafeaa0a`, `f6d9a4eb`, `860ad9b4` |
| 12 | Playwright E2E: the checkout flow | `489f46f9` (Makefile) | e2e `dc6cc779`, `b0c1afaa` |
| 13 | Generating tests with AI, then reviewing them | `95b0ea50`, `253cb54f`, `d9c11a04`, `3f040fb2`, `f83bd58e` (docs) | — (the record of the stage-1 and stage-4 test runs) |
| 14 | Profiling and needless re-renders | `f2373f9f`, `83dcf6ba` (docs) | `80940554` |
| 15 | Recap + challenge: CSV export | `ae376ac8` (docs) | — |
