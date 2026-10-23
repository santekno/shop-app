# Bab 4 — Autentikasi & otorisasi

Branch: `bab-4` (from `bab-3` @ `3b9cc9d`; Bab 3 verified code `878a8c0`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer | pass | migrations 000002–000006 (users, refresh_tokens, user_tokens, user_identities, addresses); packages `auth`, `user`, `address`, `mail`, `redisconn`; Redis joins `/readyz` |
| 1 unit tests | test-engineer | pass | 91.5% total coverage (auth 99.2%); mutation-checked after every fix round |
| 2 DB audit | database-auditor | pass | 5 findings on lock order and indexes, fixed (below), then 0 blocking |
| 3 integration | integration-engineer | pass | every auth, user and address route against real PostgreSQL and Redis; a Redis logical database per test; 8 races × 25 iterations judged on the final DB state; 1804 passed, 0 skipped on a cold `make verify` |
| 4 quality review | quality-review | pass | 2 rounds: 1 blocking (sdk `apikey` neither used nor recorded as a gap) plus 13 advice items, fixed; re-review clean |

**Verified SHA:** `803bb533183417ead5e1a9aefa1a220b1ea6462e` (2026-10-23)

Every commit in `bab-3..bab-4` passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...` at its own snapshot (48/48).

Toolchain at verification: Go 1.26.10 (`toolchain` directive), santekno/sdk v0.2.0, `ratelimitx` at pseudo-version `v0.0.0-20261022004014-97a873a6fbad`.

### What the gate changed

- **Lock order, users row first** (ADR 0005). Every path that touches a user's sessions or email tokens locks the `users` row before the token rows:
  - **B1:** a refresh racing a password reset could rotate a token the reset had just revoked.
  - **A1:** a refresh racing logout could leave a rotated token alive.
  - **A2:** concurrent email-token issue and consume could deadlock.
  - **A6:** a login racing a reset or an account deletion could create a session after it. `CreateRefreshToken` now takes `FOR SHARE` on the user and refuses a changed hash or an anonymised account.
- **Index (A3):** `user_tokens` has a full index on `(user_id, purpose)`.
- **Google double tap:** two first sign-ins of one Google account at once gave one 200 and one 409. On a lost insert, `createGoogleUser` now looks the identity up again by subject. A real collision with a password account is still 409.
- **seed-admin:** promoting an existing account replaces its password and revokes its refresh tokens in the same transaction, as a reset does. Access tokens already issued live until they expire (15 minutes by default), because the seed has no Redis.
- **Proxy hops:** `APP_TRUSTED_PROXY_HOPS` is required outside development (0–5; 1 on Railway). With a default of 0, every client behind Railway's proxy would have shared one rate-limit bucket.
- **Rate-limit keys:** IPv6 clients are keyed by their /64.
- **Headers:** every `UNAUTHORIZED` 401 carries `WWW-Authenticate`. CORS exposes `Retry-After` and `Location`.
- **Contract:** `AddressPatch` fields accept `null`.
- **sdk:** `docs/sdk-gaps.md` and ADR 0005 say why `opaque.go` does not use sdk `apikey`:
  - it looks a key up by hash, but GoShop's key carries the row id;
  - it gives 192 bits, against 256 in `opaque.go`;
  - its random source cannot be injected in tests;
  - it returns a hex hash, but GoShop stores `bytea`.
- **Per-commit build:** test fixes moved into the feat commits that needed them, so no snapshot fails its own tests.

## Decisions

- **Tokens:**
  - access tokens are HS256 JWTs (15 minutes; `iss`, `aud`, `sub`, `sid`, `jti`, role);
  - refresh tokens are opaque (`<uuid>.<base64url 32 bytes>`), stored as SHA-256 and rotated on every refresh;
  - reusing a refresh token revokes its whole family.
- **Revocation:** logging out, resetting the password or deleting the account writes `goshop:session-revoked:<sid>` in Redis, so an access token ends at once. A Redis error fails closed (500).
- **Roles:** the role is read from the database at each refresh, so a role change applies at the next refresh.
- **Admin routes:** `/v1/admin/products…` need a seller or admin token in every environment, replacing Bab 3's development-only switch.
- **Account deletion** anonymises the user, and in one transaction deletes their addresses, identities and email tokens and revokes every session. This closes the item deferred from Bab 1 and Bab 3.
- **Email:** `mail.LogMailer` writes messages to the log, with bodies only in development. A real provider waits for a later chapter.

## Deferred

- **Start of Bab 5:**
  - `httpapi.RateLimitKey` returns an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) unchanged, so it would count apart from plain `a.b.c.d`. Return `To4().String()`.
  - The compose `migrate` service gets neither `APP_TRUSTED_PROXY_HOPS` nor `GOOGLE_CLIENT_ID`, so a compose run outside development would fail at migrate.
  - After the first Railway deploy, check one real request's `X-Forwarded-For`. That Railway's edge overwrites the header rather than appending to it is known only from Railway staff answers.
- **Bab 5 hard gate**, before checkout decrements stock (carried from Bab 3):
  - `UpdateVariant` must check `AND version = @version` (0 rows → 409), and the admin GET/PUT must expose `version`.
  - Lock variants in id order before a stock restore.
  - Gate checkout on `email_verified`. An unverified pre-registration can block the real owner's Google sign-in until they reset the password; see `SECURITY.md`.

## Articles → code

Each article has a `feat` commit, a unit-test commit and an integration-test commit.

| Artikel | Topic | feat | unit tests | integration |
|---|---|---|---|---|
| 01 | Token design: ADR 0005 | `ff5675b` (docs) | — | — |
| 02 | Registration, argon2id | `626c371` | `4064a23` | `c842a6d` |
| 03 | Login and the JWT access token | `7401240` | `b6c26cb` | `ee126b5` |
| 04 | Refresh rotation and reuse detection | `52b896c` | `d1d0833` | `f54e8ff`, `f28d121` |
| 05 | Auth guard and `GET /v1/me` | `9b94986` | `9669381` | `fb415d5` |
| 06 | RBAC and `make seed-admin` | `15ad97c` | `6f441bc` | `5e65ea7`, `803bb53` |
| 07 | Email verification | `2265154` | `7af639a` | `774b569` |
| 08 | Forgot and reset password | `e5bca50` | `6123410` | `341bfc7` |
| 09 | Google sign-in | `80c455a` | `053a271` | `1aa046d`, `dfce9a7` |
| 10 | Rate limiting with Redis | `ce461ec` | `3c88f3c` | `f0501c1` |
| 11 | Profile, addresses, account deletion | `5bcb4ba` | `dd5c049` | `a06a97d` |
| 12 | Revoking sessions through Redis | `62e443d` | `3b8f340` | `8347744` |
| 13 | OWASP API Top 10 hardening | `0596019` | `71cdea3` | `79a2b4b` |
| 14 | Testing auth: seams, harness, end to end | `0336175` | `62a9e14` | `44f2929` (harness), `e0b9618` (journey) |
| 15 | Recap + challenge | conceptual | — | — |

Commits outside the article map:
- `055f964` and `858e2f5` close two Bab 3 deferred items: the seed accepts a socket-only `DATABASE_URL`, and the contract notes that raw invalid UTF-8 in JSON is accepted.
- `5f9880f` records the chapter's sdk gaps.
- `b1c6720` regenerates the catalog EXPLAIN for Bab 3's INNER JOIN.

Artikel 01 and 14 may cite `5f9880f`. The other three need no article.
