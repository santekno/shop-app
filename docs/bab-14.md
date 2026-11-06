# Bab 14 — GoShop Mobile: katalog & pencarian

Branch: `bab-14` (from `bab-13` @ `cce98cc2`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | backend-engineer, react-native-engineer | pass | Backend (artikel 01 and 12): migration `000022` (`products.is_featured` with a partial index, `banners`), migration `000023` (`wishlist_items`), `GET /v1/banners`, `GET /v1/products?featured=true`, and `GET`/`PUT`/`DELETE /v1/me/wishlist` behind `Authenticate` plus `RequireRole(buyer)`. Mobile: home with banner carousel, category chips and featured row; query key factory; infinite scroll and pull to refresh; product detail with gallery and variant picker; debounced search; filter and sort in a bottom sheet; skeletons and empty states; `expo-image`; persisted query cache; connection banner; optimistic wishlist; Reanimated feedback; dev-only perf harness; recently viewed with Zustand |
| 1 unit tests | test-engineer | pass | Go coverage gate (80%) met; new packages `banner` 100%, `wishlist` 100%, `product` 97.7%, `app` 99.3%. 592 Jest tests in `apps/mobile` (68 suites), 544 in `packages/shared`, 1446 in `apps/admin`, 1216 in `apps/web` |
| 2 DB audit | database-auditor | pass, no blocking | SQL changed, audited on a throwaway pgvector container with 10 028 products and 200 199 wishlist rows. Up, `down 1` twice, up again and `down -all` then `up` all work. Every new query uses its index (wishlist page 0.24 ms, featured page 0.09 ms), no N+1 (3 queries per wishlist page), and the 200-item cap holds under two concurrent sessions. Four advice items (below) |
| 3 integration | integration-engineer | pass | `make test-integration`: Go integration suite 0 skipped, 142 Playwright tests passed, 0 skipped. New Go integration tests: `home_banners_http`, `products_featured_http`, `wishlist_http`, `seed_home`. Eight Maestro flows written but **not executed** (below) |
| 4 quality review | quality-review | pass after one fix round | Round 1 at `cdd35385`: BLOCKED on 2 findings, both lint in new test files (below). No finding in production code. Round 2 is the fix commit `db4b5158`, re-checked by the failing command and the gates below |

**Verified SHA:** `db4b5158e1127f8a34f4052a8e329d9808ee5d06` (2026-11-06)

At `db4b5158` these ran and passed, each on its own: `make lint` (0 golangci-lint issues, Prettier and ESLint clean in every workspace, OpenAPI lint, sqlc and generated-types checks), `make test-unit`, `make test-integration` from a cold Compose project, `make build`, `make docker-build`, `make scan`, and `go test -race` on `wishlist`, `product`, `banner` and `app`.

**Read honestly.** The quality-review agent ran on `cdd35385`. Its two blockers were fixed in `db4b5158`, a commit that changes only test files and one Maestro YAML (no production code, no SQL, no OpenAPI). The review was not repeated as a second agent run; the check was the lint command that failed, plus the full set above on the new SHA. Stage 2 also ran on `cdd35385`, and the SQL is byte-identical at `db4b5158`.

### What the gate changed

- **Stage 1, shared error codes** (`ca760a3d`): `WISHLIST_LIMIT_REACHED` was missing from `SERVER_ERROR_CODES` in `packages/shared`, which failed the errors contract test. Added.
- **Stage 1, optimistic rollback** (`05b68cf4`): when the saved list had not loaded and the first toggle failed, the rollback called `setQueryData(key, undefined)`, which TanStack Query ignores, so the guessed list stayed. It now calls `removeQueries`, and the invalidate refetches the real list.
- **Stage 1, mocks and obsolete tests** (`c6f5dcf7`, `ccecd1f7`): 41 Bab 13 tests failed after stage 0 because Reanimated, worklets, Gorhom bottom sheet, expo-image and AsyncStorage had no Jest mock, and three screens had changed. Mocks live in `apps/mobile/src/test/mocks`.
- **Stage 3, environment, not code:** a colima VM disk at 94% made SeaweedFS unable to grow volumes, and 19 image-upload tests failed with a 500 from the presigned PUT. Freeing build cache fixed it; no repository change.
- **Stage 4, blocking:**
  - `errorlint`, `unused` and `sqlclosecheck` in new Go tests: `err == X` became `errors.Is`, the unused `fakeSQL.calledAll` was deleted, and the seed snapshot reuses `queryStrings` so rows close with `defer` (`db4b5158`);
  - Prettier wanted double quotes in `apps/mobile/.maestro/home-search.yaml` (`db4b5158`).
- **Flake outside the chapter:** `apps/admin` `ProductForm.conflict` (`toHaveFocus`) failed once in a `make test-unit` run and passed in three of three alone and in every later full run. Bab 14 does not touch it.

## Decisions

- **Banners, featured and wishlist come from the Go backend** (author decision, 2026-11-06). The curriculum's home screen needs data the API did not have; the alternatives were mock data or a hard-coded list.
- **Banners and the featured flag are managed by `make seed` or SQL.** There is no image upload and no admin CRUD (`docs/erd.md` records it).
- **The 200-item wishlist cap is enforced in the service** under a `LockUser` row lock, not by the database. Over the cap: `409 WISHLIST_LIMIT_REACHED` with `details.max = 200`.
- **A featured cursor is bound to the filter** (`filterKey` includes `featured` only when true), so old cursors stay valid and a featured cursor is refused on a non-featured query.
- **The persisted query cache is an allow-list** (`src/lib/query-persist.ts`): only public catalog queries, 24 h `maxAge` and `gcTime`, buster = app version. Wishlist, `me` and cart queries are never persisted, and mutations are never dehydrated.
- **No token is stored.** `src/features/wishlist/auth-seam.ts` returns `null` until Bab 15, so the heart says "Masuk dulu…" and the app never calls the wishlist API yet.
- **New dependencies:** `expo-image`, `@gorhom/bottom-sheet` 5.2.14, `react-native-gesture-handler` 3.3.0, `react-native-reanimated` 4.7.1, `@tanstack/react-query-persist-client` and `query-async-storage-persister` 5.104.5, `@react-native-async-storage/async-storage` 2.2.0, `zustand` 5.0.15. All autolink; no config plugin was needed.

## Notes

- **Ownership exceptions** (orchestrator): `packages/shared/src/api/errors.ts` (`ca760a3d`, frontend-engineer's path, one line); `toggle-options.ts`, `messages.ts`, `recent-state.ts` and their tests (`05b68cf4`); the lockfile and `pnpm-workspace.yaml` catalog entries came with `02c2a638` (react-native-engineer, reported as the rules require).
- **Commit scopes:** `c6f5dcf7`, `9f92b1f3`, `db4b5158` are scoped `bab-14` and `ccecd1f7` is scoped to artikel 01 because they serve the whole chapter; `cdd35385` is scoped `artikel-02` but holds all eight Maestro flows.
- **Per-commit, read honestly.** The chapter was built in parallel and the tests came after stage 0, so the `feat` commits were not checked one by one: stage 0 ran on the chapter head, not on each snapshot, and some `feat` commits fail the Jest suite at their own snapshot (stage 1 found 41 such failures).
- **Animation and performance** were measured as render counts and mounted cells in tests and the dev harness, not as frame times on a device.

## Deferred

- **The eight Maestro flows (`apps/mobile/.maestro`) were never run.** There is no emulator in the gate; they were only checked statically. `make test-mobile-e2e` needs a running emulator or simulator.
- **The iOS native build** is still open from Bab 13 (task 18.4) and Bab 14 adds native modules to it.
- **The wishlist cannot be used from the app until Bab 15** (login). Verified by Go integration tests and `curl`, not on a device.
- **`fetchWishlistSlugs`** pages the full wishlist (at most 3 requests of 100) only to get slugs; a slug-only endpoint is a later option.
- **Database advice:** `CountWishlistItems` joins `products`, so its cost grows with the catalog (2.2 ms at 500 000 products); featured sorted by price uses an in-memory sort, fine until about 1 000 featured products (`products_active_featured_price_idx` is the fix); `ListActiveBanners` has no `LIMIT`; the wishlist primary key and `wishlist_items_user_created_idx` share the `user_id` prefix, both are needed.
- **The persist buster** is the app version only, so a response-shape change inside one version needs a manual bump.

## Articles → code

| Artikel | Topic | feat | tests |
|---|---|---|---|
| 01 | Home: banner, categories, featured | `48b8ae5a` (API), `3ef67f59` | `f0be70c0`, `ccecd1f7`, `c90f6935`, `21d859cf`, `093b3fd7` (integration) |
| 02 | TanStack Query on React Native | `52e20c01` | `9b1a03a3`, `cdd35385` (Maestro) |
| 03 | Catalog with infinite scroll | `7aa056ab` | `ccecd1f7` |
| 04 | Pull to refresh | `26207fbf` | `ccecd1f7` |
| 05 | Product detail: gallery and variants | `44d7c7dc` | `0d502def` |
| 06 | Search with debounce | `77cc5092` | `21883ee1` |
| 07 | Filter and sort in a bottom sheet | `b9d4e7c2` | `e2a097ff` |
| 08 | Skeleton loading and empty states | `8e481f7f` | `92b31ca6` |
| 09 | Image cache with expo-image | `9f5de970` | `4139c1b9` |
| 10 | Offline cache with persisted queries | `02c2a638` | `89895483` |
| 11 | Connection detection and offline banner | `e30e4032` | `b5c6b111` |
| 12 | Wishlist with optimistic update | `8a271485` (API), `76c7f4d8`, `05b68cf4`, `ca760a3d` | `8a1edce1`, `aae6800e`, `bbd78711`, `7215d1e9`, `093b3fd7` |
| 13 | Simple animation with Reanimated | `ce5fe1dd` | `8ead42b6` |
| 14 | Measuring list performance | `cbb32503` | `2b340bcc` |
| 15 | Recap and challenge: recently viewed | `bbbe4a40` | `90ebb30c` |

Paths per article:

- 01: `apps/api/migrations/000022_*`, `apps/api/internal/banner/`, `apps/api/internal/product/`, `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/src/features/home/`
- 02: `apps/mobile/src/lib/query-keys.ts`, `apps/mobile/src/lib/query-client.ts`
- 05: `apps/mobile/app/produk/[slug].tsx`
- 07: `apps/mobile/src/features/catalog/`
- 09: `apps/mobile/src/components/Photo.tsx`
- 10: `apps/mobile/src/lib/query-persist.ts`
- 11: `apps/mobile/src/features/connection/`
- 12: `apps/api/migrations/000023_*`, `apps/api/internal/wishlist/`, `apps/mobile/src/features/wishlist/`, `apps/mobile/app/wishlist.tsx`
- 13: `apps/mobile/src/lib/motion.ts`
- 14: `apps/mobile/src/lib/perf.ts`
- 15: `apps/mobile/src/features/recent/`
