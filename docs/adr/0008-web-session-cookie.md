# 0008. Give the browser its refresh token in an httpOnly cookie on dedicated web endpoints

- Status: Accepted
- Date: 2026-10-27
- Chapter: Bab 10

## Context

[ADR 0005](0005-auth-tokens.md) decided where a browser keeps its tokens (access token in memory, refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to the auth path) and deferred the cookie until a web client existed. The storefront (`apps/web`) now exists: without the cookie a reload logs the buyer out, and the only alternative, `localStorage`, is readable by any injected script.

The storefront asked for the endpoints in [`docs/web/bab-10-auth-cookie-contract.md`](../web/bab-10-auth-cookie-contract.md). This ADR records what the API built from that request, why, and the places where it differs from it.

Forces:

- The mobile app keeps sending the refresh token in the JSON body (ADR 0005); its endpoints must not change.
- A cookie the browser attaches by itself opens CSRF, which the JSON endpoints never had: any page can make the browser send a `POST` with the cookie unless something stops it.
- `SameSite` works per **site** (scheme plus registrable domain), not per origin. Sibling subdomains are the same site.
- santekno/sdk v0.2.0 has no cookie, CSRF or CORS helper (`docs/sdk-gaps.md`); `net/http` and `go-chi/cors` cover them.

## Decision

We will serve the browser's session from **three new endpoints under `/v1/auth/web/`** that call the existing `Service.Login`, `Service.Refresh` and `Service.Logout` unchanged, and move the refresh token between the API and the browser only in an **httpOnly cookie**, with **three CSRF layers** in front of them.

### Endpoints

| Endpoint | Behaviour |
|---|---|
| `POST /v1/auth/web/login` | `Handler.Login` (same body, validation, rate limits and their Redis keys), then `200 {"data": WebSession}` and the cookie. The body never holds the refresh token. |
| `POST /v1/auth/web/refresh` | No cookie, or an empty one: `204`, no rate-limit count, no database work. Otherwise counted under the refresh limit, `Service.Refresh(cookie)` (rotation, reuse detection, `FOR UPDATE`), `200` and the rotated cookie. Every `401` clears the cookie; `429` and `500` keep it. |
| `POST /v1/auth/web/logout` | `Service.Logout(cookie)` when there is one, then clear the cookie; `204`. A `500` keeps the cookie so the client can retry. |

Code: `apps/api/internal/auth/web.go`.

### The cookie

`goshop_refresh=<id>.<secret>; Path=/v1/auth/web; Max-Age=<seconds until the token's expires_at>; HttpOnly; Secure; SameSite=Strict`, no `Domain` (host-only). Cleared with the same name, path and attributes, an empty value and `Max-Age=0`. `Max-Age` is computed from the token the service just issued and is at least 1 (Go writes no `Max-Age` for 0, which would turn it into a session cookie).

No `__Host-` prefix: it requires `Path=/`, which would send the refresh token with every API request. No `__Secure-` prefix: it requires `Secure` everywhere, which conflicts with the development switch.

**`APP_AUTH_COOKIE_SECURE`** (default `true`) can be `false` only with `APP_ENV=development`; the config loader refuses it elsewhere, naming the variable. Chromium and Firefox store a `Secure` cookie from `http://localhost`, so `make up` and the e2e suite run with the production setting; the switch is for a browser that is not in a secure context (a phone on the LAN over plain HTTP). The API logs a warning at start when it is off.

### CSRF and CORS

1. **`SameSite=Strict`**: the browser does not attach the cookie to a request another *site* starts.
2. **`X-GoShop-Client: web`**, exactly one header with exactly that value, required on all three endpoints. A page cannot add a custom header to a cross-origin request without a CORS preflight, and the preflight succeeds only for configured origins. This also stops a *same-site, different-origin* page (a compromised `blog.example.com` next to `shop.example.com`) and a "simple" `text/plain` form `POST` aimed at the login endpoint (login CSRF).
3. **`Origin`**: when the request carries one, it must be in `APP_CORS_ALLOWED_ORIGINS` (compared case-insensitively, as go-chi/cors does). A request without `Origin` (curl, a server) is not refused for that alone; it carries no cookie a browser attached.

A request that fails 2 or 3 gets `403 FORBIDDEN` with `details.reason` `client_header` or `origin`, before any rate-limit count, token work or `Set-Cookie`. The check is a middleware on the three routes only (`Handler.requireWebClient`), so an unknown path under `/v1/auth/web/` is still `404`.

**CORS** (`internal/httpserver/router.go`): requests whose path starts with `/v1/auth/web/` get their own `cors.Options` with `AllowCredentials: true`, methods `POST`, headers `Accept`, `Content-Type`, `X-Request-ID`, `X-GoShop-Client`, exposed `X-Request-ID`, `Retry-After`; every other path keeps the Bab 2 options, without credentials. Both use the same origin list and the same deny-all rule for an empty list; `*` stays refused by the config loader, and go-chi/cors echoes the origin when credentials are allowed.

### Deployment: one site

`SameSite=Strict` cookies reach the API only when the storefront and the API are the **same site**. `http://localhost:5173` → `http://localhost:8080` is (ports do not count); `https://shop.example.com` → `https://api.example.com` is. Railway's generated `*.up.railway.app` hosts are on the Public Suffix List, so two of them are **different sites** and the cookie is never sent (most browsers also block it as a third-party cookie). A deployment that uses the web session needs **custom domains for the web and the API under one registrable domain** (`docs/configuration.md`); the full deploy is Bab 19.

### Deviations from the storefront's request

- **Several `goshop_refresh` cookies are refused.** The API only ever sets one host-only cookie, so a second one in the same request was planted by someone else: a sibling subdomain can set `Domain=example.com; Path=/v1/auth/web` (cookie tossing), and the browser may list that cookie first. Using it would log the victim into the attacker's session, a login CSRF that neither SameSite nor the header stops. `/web/refresh` therefore answers `401 TOKEN_INVALID` (after the rate-limit count), clears the API's own cookie and logs a warning; `/web/logout` revokes every presented token (at most 4) and clears the cookie. The request did not cover this case.

  **What this does not stop.** The rule only fires when the victim has a cookie of their own to collide with, and even then it only delays the attack by one page load: the refused refresh clears the API's own host-only cookie, which ends the buyer's session, but cannot clear the planted `Domain` cookie. On the next page load the buyer is a visitor with no cookie of their own. A visitor with **no** `goshop_refresh` (never logged in, or logged out) who receives a planted one sends exactly one cookie; nothing marks it as foreign, so `/web/refresh` accepts it, rotates it into a host-only cookie and returns the attacker's session. The storefront shows the attacker's account as the visitor's own, and whatever the visitor does next (an address, a cart, an order) is done in the attacker's account. It lasts until the next refresh, which carries both the planted cookie and the rotated one and is refused, or longer if the attacker keeps planting. Refusing duplicates cannot detect this, and neither can SameSite, the header or `Origin`: the request really is made by the storefront's own page. Only the prerequisite can be removed: **no sibling subdomain of the shop may serve content an attacker controls** (user pages, a third-party blog or helpdesk on the same registrable domain, a dangling DNS record that can be taken over).
- **Order of checks on web login.** The request says "client header and `Origin`, then the rate limit, then the body", and also "exactly `Handler.Login`". Both hold: the header and `Origin` come first, then, as in `Handler.Login`, the body is decoded (the per-email limit needs the email), counted, and validated. A body that is not JSON is answered `400` without a count, as on `/v1/auth/login`.
- **Exactly one `X-GoShop-Client` value.** Two headers, even if one is `web`, are refused (`client_header`), and so are several `Origin` headers (`origin`).

### Reuse detection and tabs

No grace window is added. The storefront serialises refreshes across tabs with the Web Locks API, so ADR 0005's "one refresh in flight" still holds for a browser.

### Bab 12: the admin dashboard's own cookie

The admin dashboard (`apps/admin`, `http://localhost:5174` locally) uses the same three endpoints. Both apps talk to one API host, and a cookie belongs to the host that set it, not to the page that asked: with one `goshop_refresh`, logging into the dashboard replaced the storefront's session (and the reverse), and a storefront tab and a dashboard tab refreshing at the same moment could present the same token twice (the Web Lock that serialises refreshes is per origin) and trip reuse detection, revoking the session.

The client therefore names itself, and the name picks the cookie:

| `X-GoShop-Client` | Cookie |
|---|---|
| `web` | `goshop_refresh` (unchanged) |
| `admin` | `goshop_admin_refresh` |

Everything else is shared and unchanged: the endpoints, the cookie's path, `Max-Age`, `HttpOnly`, `Secure`, `SameSite=Strict` and no `Domain`; the header rule (still exactly one header, now of `web` or `admin`; anything else is `403 client_header`); the `Origin` check against `APP_CORS_ALLOWED_ORIGINS`, which lists both apps; the credentialed CORS options; the rate limits (the two apps share the per-IP refresh counter); refusing several cookies of the *same* name; and the service underneath. Both cookies have the same path, so the browser sends both to every web auth call; each call reads and writes only its own client's cookie and ignores the other. A storefront without the header is refused exactly as before.

The header is a CSRF defence and a label, not an authorisation: any allowed origin may send either value. A script running on one allowed origin (an XSS in the storefront, say) can therefore refresh the dashboard's session of the same browser and get its access token. That was already true with one shared cookie, so separating them loses nothing; binding each value to its own origins (a second origin list for `admin`) would close it and is the next step if the storefront ever shares a browser with staff accounts in production. The dashboard's role gate is in the API (`RequireRole` on `/v1/admin`), so a buyer who logs in with `admin` gets a session but no admin data.

Alternatives: a separate set of endpoints under their own path (`/v1/auth/admin/*`) would scope each cookie to its own path, but duplicates three routes, their CORS prefix and their tests for no added protection; a separate API host for the dashboard needs a second deployment of the same API.

## Alternatives considered

- **Read the cookie on the existing `/v1/auth/refresh`** — one endpoint, two transports. Rejected: the JSON endpoints would gain a CSRF surface the mobile app does not need, and the cookie's `Path` could no longer keep it away from them.
- **A double-submit CSRF token** — a second, readable cookie echoed in a header. Rejected: with `SameSite=Strict`, a required custom header and the `Origin` check it adds a moving part without closing a gap those leave.
- **`Path=/` with the `__Host-` prefix** — a browser refuses to store a `__Host-` cookie that has a `Domain` attribute, so a sibling subdomain could not plant one at all: it would close the planted-cookie login CSRF above, and the forced logout that precedes it for a logged-in buyer. The prefix also requires `Path=/` and `Secure`. `Path=/` means the refresh token would travel with every API request (catalog, cart, images, every log line's request, every proxy in front of the API) instead of the three endpoints that need it, and `Secure` everywhere means a different cookie name in development, where `APP_AUTH_COOKIE_SECURE=false` is allowed. We kept the narrow path, so the planted-cookie case stays a deployment requirement (Consequences). If a deployment cannot keep its sibling subdomains trusted, this is the switch to make, ideally with the three web endpoints on a host of their own (a same-site `auth.` subdomain) so that `Path=/` there costs nothing.
- **`SameSite=Lax`** — would also send the cookie on top-level navigations from other sites. Nothing needs that: the refresh is a `fetch` the storefront page makes, which is a same-site request.
- **The refresh token in `localStorage`** — readable by any script that runs on the page. Forbidden by ADR 0005.

## Consequences

- A browser keeps its session across reloads, and an XSS in the storefront can use the session while the page is open but cannot steal the refresh token.
- One store and one service: rotation, reuse detection, the row and user locks, the Redis revocation marker, password-reset and account-deletion revocation apply to web sessions without new code. No migration.
- A deployment must put the storefront and the API on one registrable domain; Railway's default domains do not work for the web session.
- Anyone who controls a sibling subdomain of the shop can, by planting a `goshop_refresh` cookie on the parent domain:
  - log a logged-in buyer out, then into the attacker's account: the planted cookie plus the buyer's own make the next refresh fail, and that 401 clears only the buyer's host-only cookie, ending the session. A login right after it sets a new host-only cookie beside the planted one, so the next refresh is refused the same way and logs the buyer out again. Only a page load while logged out sends the planted cookie alone, and then the case below applies;
  - silently log a visitor **without** a session of their own into the attacker's account (login CSRF): the visitor sends one cookie, which is accepted. What the visitor then saves goes to the attacker. Refusing duplicates does not see it (Deviations).

  The `__Host-` prefix would prevent both, at the cost of `Path=/` (Alternatives). With the current cookie the defence is the deployment: keep untrusted content off sibling subdomains of the shop.
- Many buyers behind one NAT share the refresh limit (60 per 15 minutes per IP), now spent once per page load of a logged-in buyer (and once per expired access token while a page stays open). A visitor without the cookie gets `204` and is not counted. If that bites, a per-session limit is the better key.
- The storefront gives up on a web session call after 20 s (`WEB_SESSION_TIMEOUT_MS` in `packages/shared/src/api/auth.ts`), longer than the API's default `APP_REQUEST_TIMEOUT` of 15 s, so it never abandons a rotation the server may still commit. That only holds while **`APP_REQUEST_TIMEOUT` stays below about 20 s**; the config accepts up to 60 s. Above 20 s a slow refresh can be rotated on the server after the client stopped waiting: the browser keeps the old cookie, its next refresh presents a used token, reuse detection revokes the session, and the buyer is logged out. Raise both together, never the server's alone (`docs/configuration.md`).
- `POST /v1/auth/web/google` is not built; when the storefront gets a Google button it follows the web login's pattern.
