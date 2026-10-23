# 0005. Authenticate with a short-lived JWT and a rotating refresh token

- Status: Accepted
- Date: 2026-10-23
- Chapter: Bab 4

## Context

From Bab 4 GoShop has accounts: buyers register and log in with email and password or with Google, sellers and admins manage the catalog. Two questions have to be answered separately:

- **Authentication**: who is calling? The API must recognise the same user on every request without asking for the password again.
- **Authorisation**: what may this caller do? A buyer may read their own addresses, a seller may edit products, only an admin may do everything (`docs/prd.md`).

Forces:

- **Three clients, one API** ([ADR 0001](0001-monorepo-one-api.md)). The web storefront (Bab 7) and admin dashboard (Bab 12) run in a browser; the mobile app (Bab 13) has no cookies to speak of, but it has a secure key store. One mechanism should serve all of them.
- **Logout and "log out everywhere" must work.** A stolen phone, a password reset and account deletion must end access within minutes, not whenever a token happens to expire.
- **The tools exist in santekno/sdk v0.2.0**: `jwtx` (HS256/HS512/RS256, `alg=none` refused), `middleware/chi` `JWTAuth` + `ClaimsFromContext`, `hashx` (argon2id), `redisx`, `ratelimitx`.
- **Readers copy this code.** It has to be correct and explainable in one article each, not the most sophisticated design.

## Decision

We will authenticate API calls with a **short-lived JWT access token** sent as `Authorization: Bearer <token>`, and keep users logged in with an **opaque, rotating refresh token** stored hashed in PostgreSQL. A small **revocation marker in Redis** ends a session's access tokens before they expire.

### Access token

- A JWT signed with **HS256** by `jwtx` with `JWT_SECRET` (at least 32 bytes; the `.env.example` placeholder is refused outside development).
- Lives **`APP_ACCESS_TOKEN_TTL`**, 15 minutes by default (1 minute to 1 hour).
- Claims: `sub` = user ID, `role` (`buyer`, `seller` or `admin`), `sid` = the session it belongs to, `jti` = a fresh UUIDv7, `iss` = `goshop-api`, `aud` = `["goshop"]`, `iat`, `exp`.
- Checked by sdk `JWTAuth` (signature, algorithm, `exp`), then by GoShop's own middleware: issuer, audience, an `exp` that must be present (jwtx accepts a token without one), a known role, and that the session is not revoked.
- The role travels in the token, so `RequireRole` decides without a database read. A role change takes effect at the next refresh, at most one access-token lifetime later.

### Refresh token

- **Opaque**, not a JWT: `<id>.<secret>`, where `id` is the row's UUIDv7 and `secret` is 32 random bytes (base64url). Only the SHA-256 hash of the secret is stored (`refresh_tokens.token_hash`). The row is found by `id`, then the hash is compared with `hashx.ConstantTimeEqual`, so the check takes the same time whether the first byte or the last one differs. A slow hash (argon2id) is not needed: 256 random bits cannot be guessed, unlike a password. The sdk's `apikey` package (`Generate`, `HashKey`, `Verify`) does a similar job but is not used: it is built to find a key by the hash of the whole key rather than by a row id, it gives 192 random bits instead of 256, it reads `crypto/rand` with no way for a test to pass its own source, and it returns the hash as a hex string where GoShop stores the 32 bytes (`bytea`); see `docs/sdk-gaps.md`.
- Lives **`APP_REFRESH_TOKEN_TTL`**, 30 days by default, counted from its own issue, so an active user stays logged in and an idle one is logged out after 30 days.
- **Rotation**: `POST /v1/auth/refresh` marks the presented token used and returns a new access token and a new refresh token. The old one never works again.
- **Families**: every token issued by one login shares a `family_id`; that family is the **session**, and its ID is the access token's `sid`. Presenting a token that was already rotated means two parties hold it (the user and a thief): the API **revokes the whole family**, and both have to log in again. The row is locked (`SELECT … FOR UPDATE`) during the rotation, so two concurrent refreshes with the same token cannot both succeed; the second is treated as reuse. There is no grace window, so clients must not refresh in parallel (one in-flight refresh per app).
- `POST /v1/auth/logout` revokes the family of the presented refresh token. A password reset and account deletion revoke every family of the user.

### Why the refresh tokens are in PostgreSQL and the revocation markers in Redis

The refresh-token store has to be **durable and transactional**: a password reset changes the hash, consumes the reset token and revokes every session in one transaction, and account deletion removes the user's sessions together with anonymising the row. PostgreSQL gives that for free; Redis would need a second write that can fail after the first one succeeded.

Access tokens are not stored anywhere, so ending one early needs a list of what is no longer valid. Redis holds **`goshop:session-revoked:<sid>`** with a TTL equal to the access-token lifetime: after that every access token of the session has expired on its own, so the key can go. The auth middleware asks Redis about the request's `sid` (one `GET`, well under a millisecond). Revoking per **session** rather than per token (`jti`) means one key covers every access token the session was given, including ones issued on other refreshes.

If Redis cannot be reached, the middleware **fails closed** (500 and an ERROR log; `/readyz` reports `redis` unavailable, so a new deployment does not take traffic until Redis answers: Railway checks `/readyz` only while a deployment starts, and a load balancer that polls it would also stop routing) instead of letting a revoked token through. If Redis loses a marker, the damage is bounded: the session's refresh token is already revoked in PostgreSQL, so the access token dies within 15 minutes.

### Where clients keep the tokens

| Client | Access token | Refresh token |
|---|---|---|
| Mobile app (Bab 13) | In memory | The platform's secure store (Keychain / Android Keystore through `expo-secure-store`), sent in the JSON body of `/v1/auth/refresh` and `/v1/auth/logout` |
| Web storefront and admin (Bab 7, Bab 12) | In memory only, never `localStorage` (readable by any injected script) | An `HttpOnly; Secure; SameSite=Strict` cookie scoped to the auth path, so page scripts cannot read it |

In Bab 4 the API takes the refresh token **in the JSON body only**. Cookie delivery is added with the web client: it needs a real browser origin, CORS with credentials for that origin, and a CSRF review of the endpoints that read the cookie, none of which exist yet. Building it now would ship untested code for a client that does not exist.

### Passwords and one-time tokens

- Passwords are hashed with **argon2id** by `hashx` (m = 64 MiB, t = 3, p = 4, 16-byte salt, 32-byte key: OWASP's 2026 parameters, encoded into the stored hash). Because one hash takes 64 MiB, at most four run at once per instance; a request waits for a free slot instead of the instance running out of memory under a login flood.
- Email verification and password reset use the same shape as refresh tokens: `<id>.<secret>`, SHA-256 hash stored in `user_tokens`, constant-time comparison, single use, with an expiry (24 hours for verification, 30 minutes for a reset).

## Alternatives considered

- **Server sessions only** (an opaque session ID in a cookie or header, looked up in Redis on every request) — simpler to revoke, and a fair choice for a browser-only app. It was not chosen because the mobile app and the browser would then authenticate differently (cookie vs header) or the mobile app would carry a session cookie by hand; because every request needs the session record to know the user's ID and role, whereas the JWT carries them and the per-request Redis read is only a yes/no existence check; and because the refresh-token rotation teaches reuse detection, which plain sessions do not have. GoShop still keeps one piece of server state per session (the refresh-token family), so this design is "sessions for login, JWT for each request".
- **One long-lived JWT, no refresh token** — nothing to look up, but a stolen token works until it expires, and logout cannot be enforced. Rejected.
- **A JWT as refresh token** — it would have to be stored anyway to rotate and revoke it, so the signature adds nothing over a random string, and its claims would be readable by whoever holds it.
- **Refresh tokens in Redis** — fast, with TTL built in, but a password reset could no longer revoke sessions in the same transaction that changes the password, and Redis is configured as a cache that may evict keys. Rejected for the store; Redis keeps only the short-lived revocation markers.
- **Revoking single access tokens by `jti`** — needs one key per issued token to revoke "everything of this session". A key per session covers them all.
- **RS256 instead of HS256** — needed when another service must verify tokens without being able to sign them. Today one API both signs and verifies; switching later means a new key type in `jwtx` and a `kid` header, not a new design.

## Consequences

- Every protected request costs one Redis `GET`, and Redis becomes a hard dependency of authenticated endpoints (the catalog stays public and works without it).
- A revoked session ends immediately; a changed **role** reaches the access token at the next refresh, within `APP_ACCESS_TOKEN_TTL`.
- Clients must handle `401` by refreshing once and retrying, and must serialise refreshes; a parallel refresh logs the user out by design.
- Rotating `JWT_SECRET` logs out nobody's refresh token but invalidates every access token at once; clients refresh and carry on.
- The refresh-token table grows with every refresh. Rows past their expiry are useless and can be deleted by a periodic job (Bab 6 worker); until then they cost disk, and revoking a session (`RevokeRefreshFamily`) gets slower the longer the session has lived, because it touches every token the family was ever given. The Bab 6 cleanup must ship `CREATE INDEX CONCURRENTLY refresh_tokens_expires_at_idx ON refresh_tokens (expires_at)` and delete expired rows in batches, which also bounds the family size.
- Every transaction that writes a user's tokens locks the `users` row first (rotation `FOR SHARE`, logout and email tokens `FOR NO KEY UPDATE`, reset and deletion by updating the row), then the token rows. One lock order means a rotation cannot slip a new refresh token past a password reset or an account deletion, and the two cannot deadlock.
- Cookie delivery for the web, a refresh grace window, and listing or revoking individual devices are not built yet; each is an addition, not a redesign.
