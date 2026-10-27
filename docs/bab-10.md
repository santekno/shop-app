# Bab 10 — Styling, design system & state global

Branch: `bab-10` (from `bab-9` @ `51d6256`; Bab 9 verified code `5bc9de2`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | frontend-engineer, backend-engineer | pass | frontend-engineer: articles 01–11 and the storefront side of 12–15: Tailwind CSS v4 through its Vite plugin, mobile-first layouts, shadcn/ui's `Button`, `Input`, `Label`, `Badge` and `DropdownMenu` changed for GoShop, design tokens, dark mode without an inline script, an AI-drafted empty cart tidied by hand, accessibility fixes (skip link, visible field edges and menu highlight, focus after logout), the guest cart token in a persisted Zustand store, the session in context, the web session (refresh token in an httpOnly cookie, access token in memory, restore at start-up, Web Locks across tabs, the guest cart merged at login), `/akun` behind `RequireAuth` with a same-origin `?kembali=`, and a refresh-token interceptor; it asked the API for the cookie endpoints in `docs/web/bab-10-auth-cookie-contract.md` (now superseded by ADR 0008). backend-engineer: `POST /v1/auth/web/login`, `/refresh` and `/logout` with the httpOnly `goshop_refresh` cookie, three CSRF layers, credentialed CORS on `/v1/auth/web/*` only, `APP_AUTH_COOKIE_SECURE` (`false` in development only), the OpenAPI additions and ADR 0008 with its deviations from the request. No migration, no `Makefile`, Compose, Caddyfile or Dockerfile change. The storefront chain was rebased onto the fixed `bab-9`; conflicts were resolved keeping Bab 9's focus fixes and Bab 10's restyle (Notes, **Rebase**) |
| 1 unit tests | test-engineer | pass | Go: total coverage 97.5% (auth 99.3, config 100, httpserver 98.3, app 99.3); 32/32 security mutations caught. TypeScript: 657 tests in `apps/web`, 243 in `packages/shared`; coverage shared 100% statements and 99.18% branches, web 99.75% statements and 98.4% branches; about 60 Bab 9 tests moved to the restyled components, the cart store and the web session without being weakened (`cb6f622`); security mutations on `safeReturnPath`, the refresh lock, the single in-flight refresh, credentials only on the web session calls and token storage, all caught. The test-engineer deleted two test-only bridge files from production paths (Notes, **Orchestrator authority**, A6) |
| 2 DB audit | database-auditor | not applicable | no migration, query or SQL change; the web endpoints call the existing `Service.Login`, `Service.Refresh` and `Service.Logout` unchanged |
| 3 integration | integration-engineer | pass | Go integration against real PostgreSQL and Redis: 4208 passed (1088 top level), 0 skipped, including 9 web-session tests with 34 subtests (`apps/api/tests/integration/auth_web_test.go`). Playwright (Chromium) against the Compose stack: 87 passed, 0 skipped, no CSP violation: theme saved and applied before `<body>`, the skip link, the web session (reload, two tabs reloaded together, logout, guest cart merge), the redirect to Masuk and back including open-redirect attempts, and session expiry (proactive refresh, one retry after a 401, a refused refresh). SeaweedFS needed `-volume.max` on a near-full disk during the runs: an environment fix, not a code change |
| 4 quality review | quality-review | pass | round 1: BLOCKED, 2 blocking (B1, B2) and 8 advice items (A1–A8); round 2: pass, 0 blocking, 4 advice items (R2-A1–R2-A4). B1, B2, A1–A5, R2-A1 and R2-A2 fixed; A6 and A7 recorded under Notes; A8, R2-A3 and R2-A4 under Deferred; round 3 (the R2-A1/R2-A2 fixes): pass, 0 blocking, 2 docs advice items (R3-A1, R3-A2) under Deferred |

**Verified SHA:** `e4ef06919c361c1779412112bb50056127cc15ee` (2026-10-27). The round-1 review read `c48baf5`, the head after stage 3; the B1/B2 fixes and the round-1 advice (`89cfeeea..3377bfc`), then R2-A1 and R2-A2 (`cc60bae`, `5a3fd0a`, `e4ef069`), followed.

**Per-commit, read honestly.** Every commit in `bab-9..bab-10` passes the TypeScript typecheck, lint and build and the Go build, vet and tests at its own snapshot (checked by an exec rebase after the rebase onto `bab-9`, and again by the per-commit loop). The web **unit tests** do not pass at every snapshot: 37 of the 62 commits pass the full loop (Go build/vet/test, TS typecheck/lint/unit), 25 do not. Unlike Bab 5–9, Bab 10's stage 1 ran after the whole of stage 0, so:
- the 19 commits from `745f1ab` (artikel 03) to `58019b7` (artikel 12) keep the Bab 9 unit tests that their restyling and the Zustand store made stale; `cb6f622` moves those tests to the new behaviour, and every commit after it is green except the next two items;
- three e2e commits (`65d5bab`, `00ad4d6`, `504a1fb`) fail only Prettier until `fc91fc7` and the next commits format them;
- the B2 fix `feacc9f` and the docs commit after it fail one old unit test until `c335530` replaces it, and `38a9dfe` (whose base is that pair) with them.
No commit ships a known defect: each failure is a test or format expectation that a later commit in the same chapter updates. Splitting `cb6f622` back into the article commits would make every commit green, as in earlier chapters; it is left as is to avoid a full history rewrite and another gate run.

`make verify` ran from a cold stack (`docker compose down -v` first) at the verified SHA and passed every stage in 626 s: 1088 top-level Go integration tests and 87 Playwright tests passed, 0 skipped, and 900 TypeScript unit tests (243 shared, 657 web; coverage shared 100% lines and 99.18% branches, web 100% lines and 98.4% branches). `apps/api` changed in this chapter, so the Go integration suite ran again under `-race` (`-timeout 60m`): 28 packages, clean.

### What the gate changed

- **Quality review B1 (open redirect after normalisation):** `safeReturnPath` checked the *input* (`//`, `/\`) and the parsed origin, but returned the parsed path, and parsing removes dot segments: `/.//evil.example`, `/x/..//evil.example/masuk`, `/%2e//evil.example` and `/./\evil.example` all came out as `//evil.example`, a protocol-relative link to another host. Only React Router 7.18.4's own "External navigation is not allowed" kept it from being a real redirect. `apps/web/src/features/auth/return-to.ts` now also refuses a parsed `pathname` that starts with `//`; the input checks stay as a fast path, and only `pathname + search + hash` is returned (`89cfeeea`). Unit tests assert that each refused input really normalises to `//` first, so no case passes vacuously (`38a9dfe`); the e2e attempts list has the four inputs (`df6e1e8`). The round-2 reviewer fuzzed the real function with 300,000 random inputs: 0 violations.
- **Quality review B2 (an add sent as a guest after the session ended):** when the proactive refresh found the session over (`204` after a logout in another tab, or `401`), `ensureFreshToken` returned `null`, which `createAuthClient` read as "a guest from the start": `POST /v1/cart/items` went out without `Authorization`, the API created an orphan guest cart, and the answer was written under a user key `onEnd` had just removed. The add looked successful and the item vanished. `ensureFreshToken` now rejects with `401 UNAUTHORIZED` when a refresh ends a session that existed, so the request is not sent; `useAddToCart` records the owner at the click, rolls back and writes only while that owner is still logged in, and refuses a logged-in answer that carries a `cart_token`; the message is "Sesi Anda sudah berakhir. Masuk lagi, lalu tambahkan barang ini." (`feacc9f`, tested in `c335530`).
- **Quality review R2-A2:** two adds queued in the cart scope, the first ending the session: the second ran as a guest (correctly, its guest token kept), but its `onSuccess` reset the guess under the user's key, writing an empty cart there. The reset now happens only when the guess was a guest's (`5a3fd0a`); a test with two queued adds checks that nothing is written under the user's key (`e4ef069`).
- **Quality review R2-A1 and A2 (docs):** a planted `Domain=` cookie from a sibling subdomain does not lock a logged-in buyer out: the duplicate-cookie `401` clears only the buyer's host-only cookie, ending the session, and from the next page load the planted cookie is sent alone and accepted. ADR 0008 and `apps/api/SECURITY.md` now say "logged out, then into the attacker's account", and cover a visitor with no cookie (login CSRF) (`3377bfc`, `cc60bae`). The mitigation is unchanged: no untrusted content on sibling subdomains.
- **Quality review advice, round 1, fixed:**
  - A1: the contract cited backend commits from before a rebase; it now cites `8324f43`, `7c728b0` and `ec13d95`, on this branch (`3d1882e`);
  - A3: the storefront's 20 s web session timeout holds only while `APP_REQUEST_TIMEOUT` stays below about 20 s (the config accepts up to 60 s); `docs/configuration.md` and ADR 0008 say so (`3377bfc`);
  - A4: `getAccessToken` reads the session manager's current value, not a ref; the comment in `session-context.ts` and `docs/web/README.md` say so (`3d1882e`);
  - A5: the refresh limit is spent once per page load of a *logged-in* buyer; a visitor without the cookie gets `204` and is not counted (`3377bfc`).
- **Found while building artikel 04:** white text on the dark theme's blue button (3.1:1, also Bab 9's cart count) and on its red `destructive` button (2.5:1) failed WCAG AA. Each theme now has its own `primary-foreground` and `destructive-foreground`, and every text pair is measured in `docs/web/README.md` (`0b23c96`).
- **Found while building artikel 03:** shadcn/ui's menu is modal by default and its scroll lock injects a `<style>` element that the storefront's CSP blocks, a violation the e2e suite fails on; `DropdownMenu` defaults to `modal={false}`. Its focus ring was a `box-shadow`, which forced-colours mode removes; it is an outline now (`745f1ab`).

## Decisions

The API side is ADR 0008 (`docs/adr/0008-web-session-cookie.md`), which records what was built from the storefront's request and four deviations from it. The storefront decisions are in `docs/web/README.md` (Bab 10 sections), `apps/web/README.md` ("The web session locally") and `docs/configuration.md` ("Deployment: the web session needs one site").

- **Web session endpoints** (`apps/api/internal/auth/web.go`): `POST /v1/auth/web/login`, `/refresh` and `/logout` call the existing `Service.Login`, `Refresh` and `Logout` unchanged, so rotation, reuse detection, the row and user locks and every revocation path apply without new code; the mobile app keeps the JSON endpoints. Refresh without a cookie is `204`, with no rate-limit count and no database work; every `401` clears the cookie, `429` and `500` keep it. Web login and refresh count under their JSON twins' rate-limit keys. `POST /v1/auth/web/google` is not built.
- **The cookie:** `goshop_refresh`, `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/web`, host-only, `Max-Age` from the token's `expires_at` and at least 1. No `__Host-` prefix: it needs `Path=/`, which would send the refresh token with every API request (ADR 0008, Alternatives). `APP_AUTH_COOKIE_SECURE` defaults to `true` and may be `false` only with `APP_ENV=development` (`apps/api/internal/config/config.go`); Chromium and Firefox keep a `Secure` cookie from `http://localhost`, so `make up` and the e2e suite run with the production setting.
- **CSRF, three layers before any count, token work or `Set-Cookie`** (`Handler.requireWebClient`): `SameSite=Strict`; exactly one `X-GoShop-Client: web` header, which forces a CORS preflight; and an `Origin`, when present, from `APP_CORS_ALLOWED_ORIGINS`. Failures are `403 FORBIDDEN` with `details.reason` `client_header` or `origin`. Several `goshop_refresh` cookies are refused as planted (cookie tossing).
- **CORS split** (`apps/api/internal/httpserver/router.go`): paths under `/v1/auth/web/` get their own options with credentials, `POST` only and `X-GoShop-Client` allowed; every other path keeps Bab 2's options, without credentials.
- **No grace window:** the storefront serialises login, refresh and logout across tabs with the Web Locks API (`goshop:session`, `apps/web/src/features/auth/refresh-lock.ts`), so two tabs reloaded together never trip reuse detection. Without Web Locks (plain HTTP on a LAN) a race ends in a logout, never a security problem.
- **Deployment: one site.** `SameSite=Strict` needs the storefront and the API on one registrable domain. Railway's `*.up.railway.app` is on the Public Suffix List, so a deployment that uses the web session needs custom domains under one domain (Bab 19).
- **Where each token lives** (`apps/web/src/features/auth/session-manager.ts`): the refresh token only in the cookie, the access token in a variable of the session manager, the guest cart token in `localStorage`. No auth token is ever written to `localStorage` or `sessionStorage` (ADR 0005). Only `webLogin`, `webRefresh` and `webLogout` (`packages/shared/src/api/auth.ts`) send `credentials: "include"`, with a 20 s timeout, longer than the API's 15 s default.
- **Start-up restore:** `SessionProvider` starts `"restoring"` and calls `restore()` once (StrictMode sends the cookie once); while restoring, the header shows neither Masuk nor a name, the cart is not fetched and an add waits.
- **Guest cart merged at login** (`apps/web/src/features/cart/merge-guest-cart.ts`, wired in `apps/web/src/app/App.tsx`): after a login or restore and before the session is published, `POST /v1/cart/merge` with the guest token; the answer goes into the cache under `["cart", "user", userId]` and the guest token is cleared. Any failure but `CART_NOT_FOUND` keeps the token for the next login. The auth feature does not import the cart.
- **Protected routes** (`apps/web/src/features/auth/components/RequireAuth.tsx`): a layout route that waits while restoring, then sends a guest to `/masuk?kembali=…` with `replace`. It spares the buyer a page of 401s; the API is the security. `safeReturnPath` accepts only a same-origin path, checked on the normalised output (B1), and refuses `/masuk`, `/daftar` and anything over 2 048 characters.
- **The interceptor** (`apps/web/src/features/auth/auth-client.ts`): a proactive refresh on demand, before the request that needs it, when the token is within `refreshMarginMs` (30 s, or half the lifetime when shorter) of expiry; no timer, so an idle tab costs nothing. After a `401 UNAUTHORIZED` one refresh and one retry, never a loop; one refresh shared by concurrent requests. A refused refresh ends the session, and a request whose session the proactive refresh ended is not sent (B2).
- **State in its place** (artikel 08): server data in TanStack Query, page state in the URL or a component; only the guest cart token (a Zustand store, `apps/web/src/features/cart/cart-store.ts`, persisted as `goshop:cart` version 1 with `safeLocalStorage`, an untrusted-input `merge` and `syncCartAcrossTabs`) and the session (context, for scoping and lifecycle) are global. The theme lives on `<html>` and in `localStorage` (`goshop:theme`).
- **Styling:** Tailwind CSS v4 through `@tailwindcss/vite`, no `tailwind.config.js` and no PostCSS; tokens in `apps/web/src/index.css` (colour roles on `:root` with `@theme inline`, `text-title`/`text-heading`, `--spacing`, one `--radius`, `max-w-page`); shadcn/ui copied into `apps/web/src/components/ui` and changed (outline focus ring, `h-10` buttons, non-modal menu); the logged-in menu (`AccountMenu`) is lazy, so a guest never downloads Radix. Contrast is measured for every pair in both themes; `--input` gives a field's edge 3:1.
- **Dark mode without an inline script:** `apps/web/public/theme.js`, a plain `<script src>` in `<head>`, sets `data-theme` before the first paint; the CSP (`script-src 'self'`, `style-src 'self'`) is unchanged.
- **AI as a draft:** `EmptyCart` was prototyped by a separate model session; the prompt, the raw output and every manual change are in `docs/web/README.md`.
- **New dependencies** (`pnpm-workspace.yaml` catalog): `tailwindcss` and `@tailwindcss/vite` 4.3.3, `@radix-ui/react-dropdown-menu` 2.2.1, `@radix-ui/react-slot` 1.5.0, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `lucide-react` 1.61.0, `zustand` 5.0.15. No new Go dependency; sdk stays at v0.2.0, and the cookie/CSRF gap is in `docs/sdk-gaps.md`.

## Notes

- **Bab 9 deferrals delivered here:**
  - Tailwind and shadcn/ui replace `index.css`: `89b114e`..`0b23c96` (artikel 01–04);
  - the guest cart kept across reloads: `5af1ca7` (artikel 10);
  - the refresh token handled, in the httpOnly cookie: `8324f43` (API), `58019b7` (storefront);
  - the access token on the requests that need it, logout, and the guest cart merged at login: `58019b7` (artikel 12);
  - refresh before expiry: `1ca892b` (artikel 14);
  - pages that need a login: `cdc2a36` (artikel 13);
  - the e2e global setup documented in `apps/web/README.md`: `89b114e`.

  Still deferred: CSP for Midtrans Snap and product photos (Bab 11).
- **Contract:** `api/openapi.yaml` adds `/v1/auth/web/login`, `/refresh` and `/logout` with `WebSession`, `WebSessionDetail`, `WebClientRejected`, the `X-GoShop-Client` header and the set/clear cookie headers; nothing existing changes shape. The storefront also calls `POST /v1/cart/merge` and `GET /v1/me` (`packages/shared/src/api/me.ts`), both in the contract since Bab 4–5. `schema.gen.ts` was regenerated (`gen-types-check` passes).
- **Rebase:** the storefront chain was rebased onto the fixed `bab-9` (`51d6256`, after Bab 9's focus fixes); the conflicts were resolved keeping Bab 9's focus fixes (`FormAlert` taking the focus, the search input synced by a ref instead of `key={filters.q}`) and Bab 10's restyle. An early copy of artikel 01–03, stacked on `bab-9-wip`, remains on `bab-10-wip` (`4a74a2d`, history).
- **Superseded contract:** `docs/web/bab-10-auth-cookie-contract.md` stays as the request the storefront made, marked superseded by ADR 0008, with the four deviations listed at its top.
- **Orchestrator authority:**
  - **A6:** `cb6f622`, a `test(...)` commit, deleted `apps/web/src/features/cart/CartTokenProvider.tsx` and `apps/web/src/features/cart/cart-token-context.ts`, which sit in the frontend-engineer's paths. They held no logic, no app code imported them, and their own comment (written by the frontend-engineer in `13989b9`) said to delete them once no test imported them; no behaviour changed. Recorded as a deviation; next time the frontend-engineer makes the deletion;
  - **A7:** `ec13d95`, a backend `docs(...)` commit, regenerated `packages/shared/src/api/schema.gen.ts`, a frontend-owned file, because `make lint`'s `gen-types-check` fails otherwise; the change is mechanical;
  - no feat, fix or docs commit in this chapter changes a test or e2e file;
  - none of these lets a test agent change production behaviour.
- **Environment, not code:** the integration runs needed SeaweedFS's `-volume.max` raised on a host disk that was nearly full; nothing in the repository changed for it.

## Deferred

- **R3-A1:** the Effect column of `docs/web/bab-10-auth-cookie-contract.md` (~line 14) describes only the forced logout; it should add that the planted cookie is accepted on the next page load (frontend-engineer).
- **R3-A2:** `apps/api/SECURITY.md` and ADR 0008 could add that a buyer who logs in again right after the forced logout is logged out again at the next refresh; only a page load while logged out gives the attacker's session (backend-engineer).

- **A8:** `WebLogin` ignores a `goshop_refresh` cookie the request already carries; a session whose restore failed with a 5xx stays valid in the database until it expires. Optional: revoke the presented cookie's session on a successful web login (best effort, logged).
- **R2-A3:** `safeReturnPath` matches `/masuk` and `/daftar` exactly, while React Router also routes `/masuk/`, `/Masuk`, `/%6Dasuk` and `/Daftar` to the auth pages. Not a loop: a logged-in LoginPage navigates to `/`, so it costs one extra hop.
- **R2-A4:** a second `401` after a successful refresh (the server refusing a fresh token, which only a misconfiguration causes) shows "Sesi Anda sudah berakhir" while the header still shows the buyer.
- **Midtrans Snap and the CSP (Bab 11):** unchanged from `docs/bab-9.md`.
- **Product photos (Bab 11; Bab 12 for admin previews):** the placeholder stays.
- **Mini cart drawer:** the artikel-15 challenge (`docs/web/README.md`); there is deliberately no `Sheet.tsx`.
- **Bab 19 (deployment):** custom domains for the web and the API under one registrable domain, `APP_CORS_ALLOWED_ORIGINS` set to the storefront's origin, `APP_REQUEST_TIMEOUT` kept below 20 s, and no untrusted content or takeover-able DNS on sibling subdomains of the shop.

## Articles → code

Each code article has a `feat` commit; unit tests, and e2e tests where the browser matters. Artikel 12 has Go tests too.

| Artikel | Topic | feat | tests (unit, integration, e2e) |
|---|---|---|---|
| 01 | Tailwind CSS basics, utility-first | `89b114e` | — (covered by the moved Bab 9 tests, `cb6f622`, `2b77f07`) |
| 02 | Responsive layout for the mobile web | `753ee41` | `05c7f23` |
| 03 | shadcn/ui: installing and changing components | `745f1ab` | `5447989` |
| 04 | GoShop's design tokens (colour, type, spacing) | `0b23c96` | — |
| 05 | Dark mode | `0917362` | `451325d`, `196245a` (e2e) |
| 06 | A quick UI prototype with AI, tidied by hand | `5268f71` | `5743ea9` |
| 07 | Accessibility: labels, focus and keyboard navigation | `7b3bfac` | `5928ad5`, `8390f57` (e2e) |
| 08 | When state should be global, and when not | `f62f7b8` (docs and a comment) | — |
| 09 | Zustand: the cart store | `13989b9` | `0fce36b` |
| 10 | Persisting the cart in `localStorage` | `5af1ca7` | `54099a6`, `00ad4d6` (e2e) |
| 11 | Context for the logged-in user | `ef1da0b` | `39b4d5f` |
| 12 | Storing tokens safely: httpOnly cookie vs memory | API: `653b623` (the request, docs), `8324f43`, `7c728b0`, `ec13d95` (ADR 0008, contract, docs), `e747315` (docs); storefront: `58019b7`, `b54024f` | Go unit `30d4136`, `ecbc9c3`; Go integration `d2babdb`; TS `a9853a7`, `0f520e8`, `898f748`, `7011152`, `e3906d7`, `cb6f622` (the Bab 9 tests moved); e2e `65d5bab`, `fc91fc7`, `2b77f07`, `504a1fb`, `167ad0f` |
| 13 | Protected routes and the redirect to login | `cdc2a36`, `89cfeeea` (B1 fix) | `0cf7cc3`, `fd8f52e`, `8b06006`, `38a9dfe`; e2e `5525572`, `df6e1e8` |
| 14 | Automatic refresh-token interceptor | `1ca892b`, `feacc9f` (B2 fix), `5a3fd0a` (R2-A2 fix) | `8da5891`, `c335530`, `e4ef069`; e2e `c48baf5` |
| 15 | Recap + challenge: a mini cart drawer | `c74c624` (docs) | — |

Cross-article: `3d1882e` (A1, A4), `3377bfc` (A2, A3, A5) and `cc60bae` (R2-A1), docs fixes from the review, scoped to artikel 12.
