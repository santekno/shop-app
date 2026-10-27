# Bab 10 artikel 12: the web session cookie, a contract request for the API

- From: frontend-engineer (storefront, `apps/web`)
- To: backend-engineer (`apps/api/internal/auth`, `apps/api/internal/httpserver`, `apps/api/internal/config`, `api/openapi.yaml`)
- Status: requested; nothing below is implemented yet
- Builds on: ADR 0005 (tokens), ADR 0006 (the guest cart token), the Bab 4 auth handlers

## Why

ADR 0005 already decided where a browser keeps its tokens: the access token in memory, the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to the auth path. It deferred the cookie until a web client existed. The storefront now needs it: today a reload logs the buyer out (Bab 9 and 10 keep the session in memory and drop the refresh token), and the only way to keep a session across reloads without the cookie would be `localStorage`, which ADR 0005 forbids because any injected script could read it.

The storefront's side (artikel 12–14) will:

1. log in through the web endpoint and keep only the access token, in memory (`SessionProvider`);
2. at start-up, ask the web refresh endpoint for a new access token; the browser sends the cookie by itself;
3. refresh once before the access token expires, one refresh at a time across every tab (below, "Reuse detection and several tabs");
4. log out through the web logout endpoint, which clears the cookie.

## Summary

| | Method and path | Request | Success |
|---|---|---|---|
| Web login | `POST /v1/auth/web/login` | JSON `LoginRequest`, header `X-GoShop-Client: web` | `200`, `{ "data": WebSession }`, sets the cookie |
| Web refresh | `POST /v1/auth/web/refresh` | no body, header `X-GoShop-Client: web`, the cookie | `200`, `{ "data": WebSession }`, sets the rotated cookie; `204` when no cookie was sent |
| Web logout | `POST /v1/auth/web/logout` | no body, header `X-GoShop-Client: web`, the cookie if any | `204`, clears the cookie |

The JSON endpoints (`/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/auth/google`) do not change; the mobile app keeps using them.

## The cookie

| Attribute | Value | Why |
|---|---|---|
| Name | `goshop_refresh` | Plain name; see "Prefixes" below |
| Value | the refresh token exactly as the JSON endpoints return it (`<id>.<secret>`) | One token format, one `Service.Refresh`; the cookie is only a different transport |
| `Path` | `/v1/auth/web` | The browser sends it to `/v1/auth/web/refresh`, `/v1/auth/web/logout` (and `/v1/auth/web/login`, which ignores it), and to no other endpoint. It never reaches the JSON endpoints, the catalog or the cart |
| `Domain` | not set | A host-only cookie: only the API's own host receives it, never a sibling subdomain |
| `HttpOnly` | set | Page scripts cannot read it: an XSS in the storefront can use the session while the page is open, but cannot steal the refresh token |
| `Secure` | set, unless `APP_AUTH_COOKIE_SECURE=false` (development only, below) | Never sent over plain HTTP |
| `SameSite` | `Strict` | The browser does not send it on a request that another site starts (CSRF, first layer) |
| `Max-Age` | seconds until the **new** refresh token's `expires_at` (`APP_REFRESH_TOKEN_TTL`, 2 592 000 for the default 720h) | The cookie disappears when the token it holds would be refused anyway. Computed from the token the service just issued, not from the config value, so the two never disagree. No `Expires` attribute: `Max-Age` wins in every current browser |

**Clearing it:** a `Set-Cookie` with the same name, `Path=/v1/auth/web`, `HttpOnly`, the same `Secure` and `SameSite`, an empty value and `Max-Age=0` (Go: `MaxAge: -1`). A different `Path` would create a second cookie instead of removing the first.

**Prefixes.** `__Host-` requires `Path=/`, which would send the refresh token with every API request; the path scope is worth more. `__Secure-` requires `Secure` on every environment, which conflicts with the development switch below. So a plain name.

**`Secure` on plain-HTTP localhost: decided.** Keep `Secure` on by default everywhere, development included, with a switch to turn it off in development only:

- Chromium and Firefox treat `http://localhost` as a potentially trustworthy origin and store a `Secure` cookie set by it. The default Compose stack (web on `http://localhost:5173`, API on `http://localhost:8080`) and the e2e suite (Chromium) therefore work with `Secure` on, and the code path the course tests is the production one.
- Some setups are not a secure context and drop the cookie silently: a phone on the LAN opening `http://192.168.x.x:5173`, or a browser that does not extend the localhost exception to cookies (WebKit has historically not). For those, `APP_AUTH_COOKIE_SECURE=false`.
- New setting `APP_AUTH_COOKIE_SECURE` (bool, default `true`). The config loader refuses `false` unless `APP_ENV=development`, with an error naming the variable, like the `JWT_SECRET` placeholder check. Add it to `docs/configuration.md` and `.env.example` (commented out, default shown).

**Same site, not same origin.** `SameSite=Strict` cookies are sent on a request from the storefront to the API only when both are on the same *site* (scheme plus registrable domain):

- `http://localhost:5173` → `http://localhost:8080`: same site (the port does not count). Works.
- `https://shop.example.com` → `https://api.example.com`: same site. Works.
- Two hosts under a domain on the Public Suffix List are different sites. Railway's generated `*.up.railway.app` domains are on it (check publicsuffix.org), so `web-xxx.up.railway.app` → `api-xxx.up.railway.app` is cross-site and the cookie is never sent; most browsers also block such third-party cookies outright. **A deployment that uses the web session needs custom domains for the web and the API under one registrable domain.** Please say so in `docs/configuration.md` (Railway section); I will say it in `apps/web/README.md`.
- `Strict` does not hurt a buyer who arrives from a search engine: the navigation itself carries no cookie, but the refresh is a `fetch` the storefront page makes to the API, which is a same-site request.

## Endpoints

All three are `POST`, under `/v1/auth/web/`, public (no `Authorization`), and send `Cache-Control: no-store` like every API response (`httpapi.SecurityHeaders`).

### Required on all three: `X-GoShop-Client: web`

The request must carry the header `X-GoShop-Client` with the exact value `web`. Otherwise: `403 FORBIDDEN`, no `Set-Cookie`, no token work, nothing counted against a rate limit.

```json
{ "error": { "code": "FORBIDDEN", "message": "this endpoint needs the X-GoShop-Client: web header", "details": { "reason": "client_header" } } }
```

**Origin check.** When the request has an `Origin` header that is not in `APP_CORS_ALLOWED_ORIGINS`: `403 FORBIDDEN` with `"details": { "reason": "origin" }` and message `"this origin may not use the web session"`. A request without `Origin` (curl, a server) is not refused for that alone; it has no cookie unless someone copied one by hand.

**Why both, on top of `SameSite=Strict`:** a custom header cannot be added to a cross-origin request without a CORS preflight, and the API answers a preflight only for its configured origins (and `Access-Control-Allow-Headers` must list the header). That stops what `SameSite` does not: a request from a *same-site but different-origin* page, such as a compromised `blog.example.com` next to `shop.example.com`, and a "simple" cross-site form POST (a `text/plain` body, which `httpapi.DecodeJSON` would otherwise parse) aimed at the login endpoint to log the victim into the attacker's account (login CSRF). The `Origin` check is the third layer for browsers that send it. Reuse the existing `FORBIDDEN` code (`httpapi.CodeForbidden`): the client never sees it in normal use, and `details.reason` says which check failed.

Order of checks in each handler: the client header and `Origin` first, then the rate limit, then the body or cookie.

### `POST /v1/auth/web/login`

Request:

```http
POST /v1/auth/web/login HTTP/1.1
Host: api.example.com
Origin: https://shop.example.com
Content-Type: application/json
X-GoShop-Client: web

{"email":"budi@example.com","password":"kopi-susu-gula-aren"}
```

Behaviour: exactly `Handler.Login` (same body `loginBody`, same validation, same `Service.Login`, same timing, same errors), then the answer below instead of `TokenPair`. A `goshop_refresh` cookie sent with the request is ignored: the new `Set-Cookie` replaces it in the browser, and the session it belonged to ends at its own expiry, as an abandoned session does today.

Success:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Set-Cookie: goshop_refresh=<id>.<secret>; Path=/v1/auth/web; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict
Access-Control-Allow-Origin: https://shop.example.com
Access-Control-Allow-Credentials: true
Vary: Origin

{"data":{"access_token":"eyJ…","token_type":"Bearer","expires_in":900,"user":{…}}}
```

The body never contains the refresh token or `refresh_expires_in`.

| Status | Code | When | Cookie |
|---|---|---|---|
| 200 | | logged in | set |
| 400 | `VALIDATION_FAILED` | body is not one JSON object or breaks `LoginRequest` (same as `/v1/auth/login`) | untouched |
| 401 | `INVALID_CREDENTIALS` | every login failure, as today | untouched |
| 403 | `FORBIDDEN` | missing/wrong `X-GoShop-Client`, or a foreign `Origin` | untouched |
| 429 | `RATE_LIMITED` | over a login limit; `Retry-After` set | untouched |
| 500 | `INTERNAL_ERROR` | as today (Redis down for the limiter, database) | untouched |

### `POST /v1/auth/web/refresh`

Request: no body (the handler does not read one; the storefront sends none), the cookie sent by the browser:

```http
POST /v1/auth/web/refresh HTTP/1.1
Host: api.example.com
Origin: https://shop.example.com
X-GoShop-Client: web
Cookie: goshop_refresh=<id>.<secret>
```

Behaviour:

- **No `goshop_refresh` cookie, or an empty one: `204 No Content`**, no `Set-Cookie`, no rate-limit count, no database work. This is the normal answer for a visitor who is not logged in, and the storefront asks at every start-up. A `401` here would put a red "Failed to load resource" line in every anonymous visitor's console (and fail the e2e suite's console check); `204` says "nothing to restore" without being an error.
- **A cookie:** count it against the refresh limit, then `Service.Refresh(cookieValue)`, the same call `/v1/auth/refresh` makes: the row is locked, the token rotated, a reused token revokes the whole family, an expired one is refused. On success: `200` with `WebSession` and a `Set-Cookie` holding the **new** refresh token (`Max-Age` from the new token's expiry).
- **Any `401` clears the cookie** (`Max-Age=0`): a refused token never works again, and keeping it would only make the next start-up fail the same way.

| Status | Code | When | Cookie |
|---|---|---|---|
| 200 | | rotated | set to the new token |
| 204 | | no cookie sent | untouched (there is none) |
| 401 | `TOKEN_INVALID` | malformed, unknown, revoked, or already used (reuse: the family is revoked, as in Bab 4) | cleared |
| 401 | `TOKEN_EXPIRED` | expired | cleared |
| 401 | `UNAUTHORIZED` | the account no longer exists (`ErrNoUser`, as today) | cleared |
| 403 | `FORBIDDEN` | missing/wrong `X-GoShop-Client`, or a foreign `Origin` | untouched |
| 429 | `RATE_LIMITED` | over the refresh limit; `Retry-After` set | untouched (the token is still good) |
| 500 | `INTERNAL_ERROR` | database or Redis failure | untouched (the token may still be good) |

### `POST /v1/auth/web/logout`

Request: no body, header `X-GoShop-Client: web`, the cookie if the browser has one.

Behaviour: when a cookie is present, `Service.Logout(cookieValue)` (revokes the family and marks the session revoked in Redis, as `/v1/auth/logout` does). Then, always, clear the cookie.

| Status | Code | When | Cookie |
|---|---|---|---|
| 204 | | always, whether or not the cookie was present or still valid (as `/v1/auth/logout`) | cleared |
| 403 | `FORBIDDEN` | missing/wrong `X-GoShop-Client`, or a foreign `Origin` | untouched |
| 500 | `INTERNAL_ERROR` | revoking failed | untouched, so the client can retry |

No access token is needed, as today: a buyer whose access token has expired can still log out.

## Rate limits

Reuse the existing limits and **their Redis keys**, so the web endpoints add no second budget for an attacker:

| Endpoint | Limits | Key |
|---|---|---|
| web login | `LimitLoginPerIP` (20 / 15 min) and `LimitLoginPerEmail` (5 / 15 min), counted before validation as in `Handler.Login` | the same `h.clientIP(r)` and `EmailKey(email)` as `/v1/auth/login` |
| web refresh | `LimitRefreshPerIP` (60 / 15 min), counted **only when a cookie is present** | the same client IP key as `/v1/auth/refresh` |
| web logout | none, like `/v1/auth/logout` | |

A request refused by the client-header or `Origin` check is not counted.

Note on the refresh limit: a buyer's storefront refreshes once per page load (navigation inside the app does not reload) and once per access-token lifetime per browser. Many buyers behind one office NAT share the 60. That is acceptable for the course; if it ever bites, a per-family limit is the better key, not a higher per-IP one.

## CORS

Today `corsMiddleware` (`internal/httpserver/router.go`) applies one `cors.Options` to every route, without credentials.

Requested:

1. **Credentials only for the web auth paths.** A second `cors.Options` for requests whose path starts with `/v1/auth/web/`, with `AllowCredentials: true`; every other path keeps today's options. The middleware picks one by `r.URL.Path` before routing (preflights included). The cookie's `Path` already keeps it away from other routes; scoping the credentials too means no other endpoint ever answers a credentialed cross-origin request.
2. **Origins:** the same exact list from `APP_CORS_ALLOWED_ORIGINS`. With credentials, the response must echo the request's origin (go-chi/cors does) and never `*`; the config loader already refuses `*`. The empty-list deny-all `AllowOriginFunc` stays for both option sets.
3. **Allowed headers** for the web paths: `Accept`, `Content-Type`, `X-Request-ID`, `X-GoShop-Client`. (`Authorization` and `X-Cart-Token` are not needed there.)
4. **Allowed methods** for the web paths: `POST` (plus `OPTIONS` for the preflight, which go-chi/cors handles).
5. **Exposed headers:** `X-Request-ID`, `Retry-After`.
6. `MaxAge: 300` as today; `Vary: Origin` as go-chi/cors sets it.

Expected preflight:

```http
OPTIONS /v1/auth/web/refresh HTTP/1.1
Origin: http://localhost:5173
Access-Control-Request-Method: POST
Access-Control-Request-Headers: x-goshop-client

HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: X-Goshop-Client
Access-Control-Max-Age: 300
Vary: Origin
```

What matters is the four `Access-Control-*` values; the success status (200 or 204), the casing of the header name (names are case-insensitive) and the full `Vary` list are go-chi/cors's defaults and may differ.

The storefront calls these three endpoints with `fetch(…, { credentials: "include" })`; it keeps `credentials: "omit"` (the default `same-origin` has the same effect cross-origin) everywhere else.

## Reuse detection and several tabs

The browser shares one cookie between all tabs of the storefront. Bab 4 has no grace window: two refreshes with the same token mean the second is a reuse, and the whole session is revoked. Two tabs opened together would both refresh at start-up and log the buyer out.

**No API change requested for this.** The storefront serialises its refreshes across tabs with the Web Locks API (`navigator.locks.request("goshop:refresh", …)`), available in every browser the storefront supports: a tab waits for the lock, and its request then carries the cookie the previous tab's answer already rotated. This keeps ADR 0005's "one refresh in flight per app" true for a browser with many tabs. If it proves insufficient in the e2e suite, I will come back with a request for a short grace window instead of working around it.

## How this sits with the existing JSON endpoints

- `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout` and `/v1/auth/google` stay as they are, body only, for the mobile app (ADR 0005's table). They never read the cookie (the cookie's `Path` keeps it from reaching them anyway) and never set it.
- One store and one service: a web login creates an ordinary refresh-token family; the web endpoints call `Service.Login`, `Service.Refresh` and `Service.Logout` unchanged. Rotation, reuse detection, `FOR UPDATE` locking, the user-row lock order, the Redis revocation marker, password-reset and account-deletion revocation all apply to web sessions without new code.
- Google sign-in on the web: not requested now (the storefront has no Google button). When it comes, `POST /v1/auth/web/google` follows the web login's pattern exactly.
- No new error codes. `FORBIDDEN` (with `details.reason`), `VALIDATION_FAILED`, `INVALID_CREDENTIALS`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL_ERROR` are reused.
- ADR 0005's "Where clients keep the tokens" table already matches; please add a short "Cookie delivery (Bab 10)" note there that points to this contract and records the `Secure` switch, the path scope and the same-site deployment requirement.

## OpenAPI additions (`api/openapi.yaml`)

- **Security scheme** `refreshCookie`: `type: apiKey`, `in: cookie`, `name: goshop_refresh`, with a description of the attributes above. Used by web refresh and web logout (`security: [refreshCookie: []]`, and `[]` alternative on logout and refresh since the cookie may be absent: `security: [{refreshCookie: []}, {}]`). Web login has `security: []`.
- **Parameter** `GoShopClientHeader`: `in: header`, `name: X-GoShop-Client`, `required: true`, `schema: { type: string, const: web }`, referenced by all three operations.
- **Schemas** `WebSession` (`access_token`, `token_type` (`const: Bearer`), `expires_in`, `user` (`$ref: User`); `additionalProperties: false`; descriptions as in `TokenPair`, plus "the refresh token is in the `goshop_refresh` cookie, never in the body") and `WebSessionDetail` (`{ data: WebSession }`).
- **Response** `WebClientRejected` (403, `FORBIDDEN`, examples for `details.reason` `client_header` and `origin`).
- **Response header** `Set-Cookie` documented on web login `200`, web refresh `200` and `401`, and web logout `204` (`schema: { type: string }`, with an example of each form: set and cleared).
- **Paths** `/v1/auth/web/login` (`operationId: webLogin`), `/v1/auth/web/refresh` (`webRefresh`), `/v1/auth/web/logout` (`webLogout`), tag `Auth`, with the status tables above, each `description` starting with its rate-limit line as the other auth operations do.
- Descriptions of `TokenPair.refresh_token` and the `bearerAuth` scheme mention that web clients get the refresh token in the cookie and the access token from `/v1/auth/web/login` or `/v1/auth/web/refresh`.

After the contract changes, `make gen-types` regenerates `packages/shared/src/api/schema.gen.ts`; I own that file and the client functions (`webLogin`, `webRefresh`, `webLogout`) in `packages/shared`.

## Tests I would expect to exist (for backend-engineer and test-engineer)

- Each endpoint without `X-GoShop-Client`, with a wrong value, and with a foreign `Origin`: `403 FORBIDDEN`, the right `details.reason`, no `Set-Cookie`, no rate-limit count.
- Web login: success sets the cookie with exactly the attributes above (`Path`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age` equal to the token's remaining lifetime) and the body has no `refresh_token`; every failure leaves `Set-Cookie` absent; shares the login counters with `/v1/auth/login`.
- Web refresh: no cookie gives `204` with no counter increment; a valid cookie rotates (the old value then gives `401 TOKEN_INVALID` **and** revokes the family, so the new value also fails); expired gives `TOKEN_EXPIRED`; every `401` clears the cookie; `429` and `500` leave it alone.
- Web logout: `204` and a clearing `Set-Cookie` with or without a cookie, the session's access token is refused afterwards (`401 UNAUTHORIZED` on `/v1/me`).
- CORS: a preflight from an allowed origin to `/v1/auth/web/*` gets `Allow-Credentials: true` and `X-GoShop-Client` in `Allow-Headers`; the same preflight to `/v1/products` gets no `Allow-Credentials`; a disallowed origin gets no CORS headers.
- Config: `APP_AUTH_COOKIE_SECURE=false` is accepted with `APP_ENV=development` and refused with `staging` and `production`.
- e2e (integration-engineer, once the storefront side exists): log in, reload, still logged in; two tabs reloaded together stay logged in; log out clears the cookie and a reload stays logged out.
