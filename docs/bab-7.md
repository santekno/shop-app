# Bab 7 — JavaScript & TypeScript modern untuk React

Branch: `bab-7` (from `bab-6` @ `b3cf6ab`; Bab 6 verified code `33c05d5`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | frontend-engineer | pass | the pnpm workspace's first packages: `packages/shared` (typed API client, URL builder, category tree, async helpers, types generated from the contract) and `apps/web` (Vite + React 19 storefront with one page, the category list); a Caddy image (`apps/web/Dockerfile`), the Compose `web` service and `deploy/railway/web.json`; no Go, SQL or contract change |
| 1 unit tests | test-engineer | pass | 183 TypeScript tests at the verified SHA (140 in `packages/shared`, 43 in `apps/web`), including the contract test for `SERVER_ERROR_CODES`; coverage `packages/shared` 100% statements, functions and lines, 98.98% branches; `apps/web` 100% on every metric; `make test-unit` enforces 70% per file; 63 mutations in the first round, all caught once one survivor (the loop cut in the category tree) got a test (`93e8754`), then 3 for the URL fix and 4 for the post-review assertions, all caught; 1 production bug found and fixed (below) |
| 2 DB audit | database-auditor | not applicable | no migration, query or SQL change in this chapter |
| 3 integration | integration-engineer | pass | Playwright (Chromium) against the Compose stack: the storefront container, a real API outage and recovery, the CSP enforced in the browser, the security headers, the SPA fallback, a non-root Caddy, and `@goshop/shared` against real API errors and dead servers; 22 tests, 0 skipped, with a reporter that fails the run on any skipped test; no production bug found |
| 4 quality review | quality-review | pass | round 1: 1 blocking (B1), 11 advice items, all fixed; round 2 re-review, run against two images the reviewer built: pass, 0 blocking, with two e2e suggestions, both applied; round 3, the rebase onto `bab-6`: 1 blocking (`ServerErrorCode` missed the seven codes Bab 6 added to the contract), fixed in `a715e0c` with a contract test in `0c3b889`, plus 2 advice items recorded under Deferred; round 4, re-review of `a715e0c`/`0c3b889`: pass, 0 blocking, 4 advice (Deferred) |

**Verified SHA:** `0c3b889b30a92dcbff2cc6def35299c801ad3f44` (2026-10-26). The gate first passed on `c48f169`, on `bab-7-wip` based on `bab-4` (`0522443`). The branch was rebased onto `bab-5` (`6315081`, checked commit by commit, 22 e2e tests), then onto `bab-6` (`3ce280f`, full gate passed), and after the round-3 fix the whole verification ran again on the new SHA (Notes, **Rebases**).

Every commit in `bab-6..bab-7` (`d806224`, this record, included) passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...`, and the TypeScript typecheck, lint and unit tests, at its own snapshot (37/37).

`make verify` ran from a cold stack (`docker compose down -v` first) at the verified SHA and passed every stage in 564 s (535 s at `3ce280f`): 22 Playwright tests passed, 0 skipped, 183 TypeScript unit tests (140 shared, 43 web) passed, and the Go suites were green with 0 skipped. `apps/api` is byte-identical to Bab 6's verified `33c05d5`, whose Go integration suite passed under `-race`; it ran again under `-race` at `3ce280f`, clean.

### What the gate changed

- **Unit tests found a production bug:** `createUrlBuilder` accepted a base URL ending in a bare `?` or `#` and put that character in front of every path: `http://localhost:8080/?` built `http://localhost:8080/?/v1/categories`. `new URL` reports an empty `search` and `hash` for these, so the builder now checks `href` and throws a `TypeError` for any query or fragment. The fix is in the artikel-02 commit (`9d33275`); `98c1243` tests the three bare-`?`/`#` cases and a percent-encoded `%3F`/`%23` in the path, which is still accepted.
- **Quality review B1:** `/healthz` in the web container answered `index.html`, not the probe, because Caddy runs `try_files` before `respond`, so the `respond /healthz` line never took effect. The README and the Caddyfile's own comment said otherwise, and the e2e test only checked for a 200. The Caddyfile now has separate `handle` blocks:
  - `/healthz` answers 200 `ok` as `text/plain`;
  - a missing file under `/assets/` is a 404 with `no-store`, not `index.html` cached for a year under a script's name;
  - any other path gets its file or `index.html` with `no-cache`;
  - every response, errors included, carries the security headers and no `Server` header.
- **Quality review advice, eleven items, all fixed.** Among them:
  - the CSP's `connect-src` is now the **origin** of `VITE_API_URL`, computed at image build; a base URL with a path was blocked, because a CSP source with a path allows only that exact path;
  - a `Permissions-Policy` that turns off camera, microphone, geolocation and payment;
  - the storefront's per-attempt timeout went down from the client's 10 s to 5 s: against an API that hangs, a buyer waited about 31 s for the error, now about 16 s (3 × 5 s plus 0.3 s and 0.6 s of backoff);
  - the artikel-13 lint commit also carried logic changes for artikel 06 and 07; they moved back into the commits they belong to;
  - comments that taught the wrong thing were corrected: `Object.entries` puts integer-like keys first, `Readonly` is checked only at compile time, the loop note in the category tree, where `retry<T>` lives in the docs, and the claim about Go generic methods now says "as of Go 1.26";
  - the e2e suite's need for the `make seed` catalog is documented (`3ce280f`).
- **Tests after the review:** the 5 s timeout is checked at its edge (the request is still alive at 4,999 ms and fails with `CLIENT_TIMEOUT` at 5,000 ms); a test shows that `"01"`, `"-1"` and `"1.5"` are not integer-like keys; the caller's abort reason is checked all the way to `fetch`'s signal. The e2e suite checks `/healthz`, the 404 with `no-store`, `Permissions-Policy` on every response, and builds an image with `VITE_API_URL=http://localhost:18080/base/` to check that only the origin reaches `connect-src` while the bundle keeps the full URL.
- **Re-review suggestions:** the CSP test's Compose project and image get a name unique to each run, so two runs cannot collide; the outage test measures the time between failures, not from the start, so page navigation does not count against the timeout budget.
- **Secret scan:** a test URL with an encoded `?` in its userinfo (a user and password before an `@`) looked like a URL with credentials to `scripts/secret-scan.sh`, so `make scan` failed; the case now uses `http://localhost:8080/a%3Fb%23c/`. The per-commit loop runs the secret scan too.
- **Integration:** `make test-integration` builds and starts the `web` service and runs `make seed` (idempotent, local only) before the e2e suite, so the category page has data.

## Decisions

No ADR in this chapter: no API, data or deployment-model change. The web decisions are recorded in `docs/web/README.md` and `apps/web/README.md`.

- **Workspace:**
  - pnpm 10 with `apps/*`, `packages/*` and `e2e`; one catalog in `pnpm-workspace.yaml` pins every tool once (TypeScript 5.9.3, React 19.3.1, Vite 8.3.5, Vitest 5.0.5, ESLint 10, Prettier 3.9, openapi-typescript 7.13.0, Playwright 1.64.1); Node 24 (`.nvmrc`);
  - `packages/shared` has no build step: apps and Node import its `.ts` source, so it uses only syntax that type stripping removes (`erasableSyntaxOnly`: no `enum`, no `namespace`) and names every relative import with its `.ts` extension;
  - one public entry point, `packages/shared/src/index.ts`, with `"exports"` and `"sideEffects": false` in its `package.json`;
  - TypeScript `strict` with `noUncheckedIndexedAccess`; ESLint `strictTypeChecked` with `eqeqeq`, no warnings allowed, and `prettier --check` in `make lint`.
- **API client** (`packages/shared/src/api/client.ts`):
  - `createApiClient` returns a plain object, not a class; option types are derived from one `ApiClientConfig` with `Pick`, `Partial` and `Omit`;
  - one error type, `ApiError`, for every failure: the server's `code`, `details` and `X-Request-ID`, or a client code (`NETWORK_ERROR`, `CLIENT_TIMEOUT`, `ABORTED`, `INVALID_RESPONSE`); `code` is typed `string` because a newer API may send a code this client does not know, and `isApiError` narrows only to known codes;
  - a timeout per attempt with `AbortController` (default 10 s), and the caller's `signal` cancels the request;
  - retries only for GET and HEAD, only on a network failure, a timeout or 502/503/504, with backoff from 300 ms doubling; none by default;
  - the storefront's client uses 5 s and 2 retries (`apps/web/src/lib/api.ts`).
- **URL builder** (`packages/shared/src/api/url.ts`): the base URL is checked once (http or https only, no query, no fragment, trailing slashes trimmed); a path must start with `/`; query values that are `null` or `undefined` are left out.
- **Types from the contract:** `openapi-typescript` writes `packages/shared/src/api/schema.gen.ts` from `api/openapi.yaml`; it is never edited by hand. `make gen-types` regenerates it, and `make gen-types-check`, part of `make lint`, fails when it is stale (shown in stage 3 by changing `openapi.yaml`). Short aliases live in `types.ts`.
- **Storefront** (`apps/web`): a Vite + React 19 single-page app with one page in this chapter, the category tree from `GET /v1/categories`, loaded by `useCategoryTree` (abort on unmount, reload on "Coba lagi"). The dev server runs on `localhost:5173` with `strictPort`, the origin the API's CORS default allows.
- **`VITE_API_URL` is a build argument:** Vite bakes it into the bundle, so it is public and one image serves one API; `vite build` and `docker build` stop when it is missing. Chosen over a run-time `config.js` because it needs no start script and Railway rebuilds on every deploy anyway.
- **Container:**
  - `node:24.22.1-alpine` builds, `caddy:2.11.7-alpine` serves `dist/` on `$PORT` as an unprivileged user with Caddy's file capability removed, its admin API off and automatic HTTPS off;
  - `/healthz` for Docker and Railway, hashed `/assets/` cached for a year, everything else revalidated on each visit, the security headers and CSP on every response;
  - no `Strict-Transport-Security`: TLS ends at Railway's edge, which sets it with the custom domain;
  - the Compose `web` service publishes `127.0.0.1:5173`, so run it or `pnpm dev`, not both.
- **Tests:**
  - Vitest with v8 coverage, 70% per file on lines, branches, functions and statements, enforced by `make test-unit`; `apps/web` tests run in jsdom with Testing Library, and swap the API for the real client over a fake `fetch`;
  - the Playwright suite in `e2e/` runs from `make test-integration` and `make verify` after the Go suite, and its reporter (`e2e/support/no-skips-reporter.ts`) fails on `test.skip`, `test.fixme` or a test that never ran, as `scripts/no-skips.sh` does for Go.

## Notes

- **Bab 6 deferral delivered here:** the types are regenerated from Bab 6's contract (product images with `variants`), below.
- **Rebases:**
  - onto `bab-5` (as `6315081`): one text conflict, the Makefile's `.PHONY`, kept from both sides; the e2e workspace's ESLint and Prettier skip `e2e/k6/`, Bab 5's load test, which uses k6 globals such as `__ENV`; the types were regenerated from Bab 5's contract in the artikel-11 commit, and the seventeen Bab 5 error codes added to `ServerErrorCode`, each checked against the contract;
  - onto `bab-6`: three commits changed, the other 31 are identical (`git range-diff bab-5..bab-7-wip bab-6..bab-7`). `3fdfdd3` (feat artikel-11) takes the union of both `.PHONY` lists and regenerates `schema.gen.ts` from Bab 6's contract: the pay, Midtrans notification, sales report and product image routes, `ProductImage` and `ImageVariant`, and a required `images` field on `Product`. `e1f2edc` keeps Bab 6's `worker` service and adds Bab 7's `web` in `docker-compose.yml`. `2fa9ef7` keeps `worker` among the services `make test-integration` starts. Nothing in Bab 7 reads products yet, so no Bab 7 code changed with the contract.
- **`ServerErrorCode` and Bab 6:** after the rebase the union still listed the codes up to Bab 5, so `isApiError(error, "PAYMENTS_DISABLED")` did not compile. `a715e0c` derives it from an `as const` array, `SERVER_ERROR_CODES`, that now holds all 42 codes the contract documents, the seven Bab 6 ones (`PAYMENTS_DISABLED`, `PAYMENT_WINDOW_CLOSED`, `INVALID_SIGNATURE`, `STORAGE_DISABLED`, `IMAGE_LIMIT_REACHED`, `UPLOAD_INVALID`, `UPLOAD_MISSING`) in their own group. `0c3b889` adds a unit test that compares the array with the codes `api/openapi.yaml` documents, in both directions, so the next contract change cannot drift silently.
- **Cross-article commits:** `0c5b0b1` indexes `docs/web/README.md` and `apps/web/README.md` in `docs/README.md` and gives `docs/web/**` an owner in `CLAUDE.md`.
- **Orchestrator authority:**
  - `3fdfdd3` feat(bab-7/artikel-11) and `7b10505` feat(bab-7/artikel-12) changed the backend-owned `Makefile` (the install stamp, `gen-types`, `gen-types-check` in `make lint`, the default `VITE_API_URL` in `make build`);
  - `c2509fa` test(bab-7/artikel-13) changed the backend-owned `Makefile` (`--coverage` in `make test-unit`) and added `@vitest/coverage-v8` to the frontend-owned catalog and package manifests; `f291f74` added Testing Library the same way;
  - `2fa9ef7` test(bab-7/artikel-13) changed the backend-owned `Makefile`, so `make test-integration` starts `web`, seeds and runs the e2e suite; `ba18b07` added `@playwright/test` to the frontend-owned catalog;
  - during the rebase onto `bab-5`, frontend-engineer added the `k6/` exclusion to the integration-owned `e2e/eslint.config.js` and `e2e/.prettierignore` (in `ba18b07`);
  - the stage 1 and stage 4 fixes were folded into the commits they belong to (`9d33275`, the artikel-06 and artikel-07 commits, `e1f2edc`, `7b10505`), so each commit shows its final code;
  - none of these lets a test agent change production code.
- **Deliberate gaps** for later chapters: no router, no data-fetching library and no CSS framework yet (Bab 8–10); the storefront is a Vite SPA until the Next.js migration in Bab 11.

## Deferred

- **Contract test (round 4 advice):** `errors.contract.test.ts` finds codes in backticks and in unquoted `code: X` examples only; a code mentioned without backticks or quoted in an example would drift silently. Accept quotes in the example pattern, write the backtick convention into the header of `api/openapi.yaml`, and add `HEAD` and `OPTIONS` to the words it ignores; longer term an `enum` or `x-error-codes` list on `Error.code` removes the regex.
- **Concept map (round 4 advice):** the artikel-08 row of `docs/web/README.md` should name `as const` and `(typeof X)[number]`, which `SERVER_ERROR_CODES` now teaches.

- **Web CSP and product photos:** `apps/web/Caddyfile` allows `img-src 'self' data: https:` and no Midtrans origin; the chapter that first shows product photos or Snap must widen it (rebase review advice).
- **`apps/web/README.md`:** `make dev-api` with postgres and redis is enough for Bab 7; storage and the worker are needed once the page shows photos (rebase review advice).
- **Bab 8–9 (web):** rebase onto `bab-7` and keep `make gen-types-check` green.
- **Bab 19 (deployment):** `Strict-Transport-Security` at the edge with the custom domain; one web image per API URL (`VITE_API_URL`).

## Articles → code

Each code article has a `feat` commit and unit tests; where the browser or the running API matters, e2e tests too.

| Artikel | Topic | feat | tests (unit, e2e) |
|---|---|---|---|
| 01 | JavaScript for Go developers: the mental model | `a4b6129` (docs) | — |
| 02 | `let`/`const`, arrow functions, scope and closures | `9d33275` (with the URL fix) | `98c1243` |
| 03 | Destructuring, spread and rest | `34bf3d4` | `44745bb` |
| 04 | Array methods: `map`, `filter`, `reduce` | `108912f` | `e96da98`, `93e8754` |
| 05 | ES modules: `import` and `export` | `48c9a1d` | — (every `apps/web` test imports through `@goshop/shared`) |
| 06 | Promises and `async`/`await` vs goroutines | `50d0c79` | `133113e` |
| 07 | The Fetch API and error handling | `87ecb8e` | `04d6827`, `6b9b5c7` (e2e) |
| 08 | TypeScript basics: `type`, `interface`, unions | `a2eeed2`, `a715e0c` (fix) | `21de243`, `0c3b889` |
| 09 | Generics in TypeScript vs Go | `c945d15` | `6ea6873` |
| 10 | Utility types: `Partial`, `Pick`, `Omit` | `e52efaf` | `56241a7` |
| 11 | Generating TS types from GoShop's OpenAPI | `3fdfdd3` | `43bbafb`, `d321c3a` (e2e) |
| 12 | Vite: a React + TS project | `7b10505`, `e1f2edc` (container), `3ce280f` (docs) | `f291f74`, `001d002` (e2e) |
| 13 | ESLint, Prettier and team rules | `87f1e2c` | `c2509fa` (coverage gate), `ba18b07`, `2fa9ef7` (e2e workspace and `make` targets) |
| 14 | Asking AI to explain confusing JS correctly | conceptual: `docs/ai-rules.md` and this chapter's stage 4 review (the corrected comments) | — |
| 15 | Recap + challenge: a typed GoShop API client | `18145dd` (docs) | — |

Cross-article: `0c5b0b1` (docs index and ownership).
