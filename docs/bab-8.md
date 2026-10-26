# Bab 8 — React dasar: membangun UI katalog

Branch: `bab-8` (from `bab-7` @ `e2b023c`; Bab 7 verified code `0c3b889`)

## Verified gate

| Stage | Agent | Result | Notes |
|---|---|---|---|
| 0 build/lint/docker | frontend-engineer | pass | the storefront's catalog and product pages in plain React: `ProductCard`, `Card`/`Section` composed through `children`, `QuantityStepper`, `VariantPicker`, `ProductGrid`, the loading/empty/error components, `useDocumentTitle`, the `useProducts` (cursor "load more") and `useProduct` hooks; `listProducts`, `getProduct` and `formatRupiah` in `packages/shared`; no Go, SQL, contract, `Makefile` or Compose change; in the browser against the real API, 28 products loaded page by page, the stepper stopped at the stock, going back to the catalog fetched nothing again, and the console stayed clean |
| 1 unit tests | test-engineer | pass | 333 TypeScript tests on the rebased branch (157 in `packages/shared`, 176 in `apps/web`); at the end of stage 1 coverage was 100% statements and lines in `packages/shared`, 98.9% statements and 100% lines in `apps/web`; `make test-unit` enforces 70% per file; 58 mutations in the first round, 53 caught (two only after a "previous visit" test was added) and 5 equivalent to the original code; after the bug fix every mutation around the reset was caught except two backup checks in state updaters that cannot fire during a synchronous render; 1 production bug found and fixed (below) |
| 2 DB audit | database-auditor | not applicable | no migration, query or SQL change in this chapter; `apps/api` is byte-identical to Bab 6's verified `33c05d5` |
| 3 integration | integration-engineer | pass | Playwright (Chromium) against the Compose stack and the real API: the catalog followed through every cursor page of the seeded catalog, every card's name, category, rupiah price, "Mulai" and "Stok habis", the product page (default variant, the stock and 99 caps, clamping, the subtotal, back without a refetch), an encoded slug and a 404, the outage and recovery of each section, an accessibility smoke test, and one run against the Vite dev server that fails on any React development warning; 41 tests after the review, 0 skipped; no production bug found |
| 4 quality review | quality-review | pass | round 1: 1 blocking (B1), 5 advice items, all fixed; round 2 re-review: pass, 0 blocking, with small suggestions, three applied during the rebase onto `bab-5` and one already done; round 3, the rebase onto `bab-7`: pass, 0 blocking, 3 advice items (A1–A3), all applied in `885b2d6` and `212eed3` |

**Verified SHA:** `212eed3b7f1ff74b8c81b08563330c925e6a6b9b` (2026-10-26). The gate first passed on `bab-8-wip`, stacked on `bab-7-wip` when that was based on `bab-4`. The branch was rebased with Bab 7 onto `bab-5` (`99d315c`, checked commit by commit, 41 e2e tests), then onto the fixed `bab-7` (`0c3b889`, itself on `bab-6`) as `aca93ff`, which the round-3 review passed; after its two advice commits the whole verification ran again on the new SHA (Notes, **Rebases**).

Every commit in `bab-7..bab-8` passes `go build ./...`, `go vet -tags=integration ./...` and `go test ./...`, and the TypeScript typecheck, lint and unit tests, at its own snapshot (37/37).

`make verify` ran from a cold stack (`docker compose down -v` first) at the verified SHA and passed every stage in 438 s: 41 Playwright tests passed, 0 skipped, and 333 TypeScript unit tests (157 shared, 176 web; coverage shared 100% lines and 99.01% branches, web 100% lines and 97.05% branches). `apps/api` is byte-identical to Bab 6's verified `33c05d5`, whose Go integration suite passed under `-race` (and again at Bab 7's `3ce280f`), so that run carries over.

### What the gate changed

- **Unit tests found a production bug:** `useProducts` loaded the last page of a list twice when the filters went A → B → A before B's first page arrived, so products appeared twice and React warned about duplicate keys. The list was replaced only when a response arrived, so on the way back to A the hook still held A's old list, whose cursor pointed at a page already loaded. The catalog cannot change filters yet, so no buyer could hit it, but the artikel-15 category challenge would. The hook now starts a new list during render as soon as the filters' key changes (React's "adjust state when a prop changes" pattern, in line with artikel 09's lesson against deriving state in an effect) and ignores updates that arrive for other filters; `useProduct` got the same fix for its slug. The fix is in the artikel-11 commit (`b72d7b9`); `c87bd70` has A → B → A regression tests for both hooks, which fail against the code before the fix.
- **Quality review B1:** the comment in `ProductGrid.tsx` taught the wrong `key` rule: it said an index as key breaks once "load more" adds a page. Appending items does not shift the index of the ones already there; an index breaks when items are inserted or removed in front, or reordered by a filter or sort. Artikel 07 is written from this file, so the comment now says that (`c61f6f5`); the key stays `product.id`.
- **Quality review advice, five items, all fixed:**
  - the JSX comment now says that with `jsx: react-jsx` the compiler emits `jsx()` from `react/jsx-runtime`, with `React.createElement` as the older transform (`app/SiteHeader.tsx`, `faf4f63`);
  - coming back from a product, focus went to `<body>`; `App` now gives it back to the card that was opened (a ref and an effect, safe under StrictMode and when the card is gone), which also scrolls it into view (in Chromium, from a scroll of 1510 to the product and back to 1510);
  - switching variant left the stored quantity above the new variant's stock, so switching back showed an old number; the variant handler `selectVariant` now clamps it, so the stored and the shown quantity are always the same (12, then 8 on a variant with less stock, still 8 on the way back);
  - a `next_cursor` equal to the cursor just used is treated as the end of the list, so a bug in the API cannot turn into an endless list;
  - `docs/web/README.md` notes that the components of articles 03–09 first appear on screen at artikel 10.
- **Tests after the review:** unit tests for the new behaviour; e2e checks that focus returns to the opened card, the scroll position comes back, and the quantity stays clamped after a variant change (41 e2e tests, 0 skipped).
- **Re-review suggestions**, applied during the rebase onto `bab-5`: `CSS.escape` around the slug in the focus selector; `window.scrollTo` moved into the artikel-12 commit, where opening a product belongs; a focus note in the artikel-15 challenge (a card that a new filter removed cannot take the focus back). A fourth, a run-unique Compose project name for the CSP test, was already in place.
- **Rebase review advice (round 3):**
  - A1: `ProductImage.tsx` said "Products have none until uploads arrive (Bab 6)", false in the cumulative branch, where Bab 6 comes first and the API sends `images`. The comment now says this chapter shows the placeholder on purpose and Bab 11 wires photos (`885b2d6`);
  - A2: the Bab 8 section of `docs/web/README.md` says the same: `images` is ignored, every card shows "Belum ada foto", even for a product given a photo in Bab 6 (`885b2d6`);
  - A3: the e2e `ProductRow` claimed to be the product "as the contract defines it" but left out `images` and `created_at`. Both are added, with `ImageRow` and `ImageVariantRow` written to match the contract; `catalog-cards.spec.ts` now says it is the seed that writes no photos and asserts each product's `images` is empty before expecting the placeholder, so a seed that gains photos fails by name (`212eed3`).

## Decisions

No ADR in this chapter: no API, data or deployment-model change. The web decisions are recorded in `docs/web/README.md` (Bab 8 section) and in the code's comments.

- **Plain React first:** no router, no data-fetching library and no CSS framework in this chapter. Bab 9 replaces `selectedSlug` with React Router and the hand-written hooks with TanStack Query; Bab 10 replaces `index.css` with Tailwind and shadcn/ui. Each of these pieces is marked in the code as the one that will be replaced.
- **Navigation without a router** (`apps/web/src/app/App.tsx`):
  - the open product is `selectedSlug` state in `App`, the closest component above the header, the catalog and the product page (artikel 12, lifting state up);
  - the catalog is hidden, not unmounted, while a product is open, so the pages already loaded are still there after "Kembali";
  - opening a product scrolls to the top; going back gives the focus to the card that was opened (a ref, not state, and an effect; `CSS.escape` keeps any slug safe in the selector); the product page's back button takes the focus when it opens.
- **Data** (`packages/shared/src/api/catalog.ts`):
  - `listProducts` returns the whole `{ data, page }` body, because the caller needs `page.next_cursor`; its query is `ListProductsQuery`, derived from the generated `operations["listProducts"]`, so a misspelt filter is a compile error;
  - `getProduct` puts the slug through `encodeURIComponent`;
  - `Money`, `Product`, `ProductList`, `ProductDetail` and `ProductVariant` are aliases of the generated schemas in `types.ts`; nothing is written by hand.
- **Hooks:**
  - `useProducts` loads 12 products per page (`CatalogPage`), appends each "Muat lebih banyak" page, retries the failed page, aborts the request in flight on unmount, and keys the list by its filters' primitive values, so `useProducts({ limit: 12 })` with a new object each render does not restart it; `hasMore` comes only from `next_cursor`, because a page may hold fewer products than `limit`;
  - `useProduct` loads one product by slug the same way; `ProductDetailPage` shows `NOT_FOUND` as "Produk tidak ditemukan." and any other error with a retry;
  - loading state is a discriminated union, `AsyncState<T>` (`apps/web/src/lib/async-state.ts`), so only the success variant has `data`.
- **Effects:** used only to stay in step with something outside React: the network, with abort on unmount, and `document.title` (`useDocumentTitle`, which restores the previous title on cleanup). Values computed from props or state are computed during render ("Mulai", the subtotal), and `ProductDetail` renders only once its product is loaded, so its state starts from the product with a plain `useState` initial value.
- **Product page:**
  - the default variant is the first one in stock, or the first one when all are sold out;
  - the quantity is 1 up to the variant's stock, capped at 99, and 0 for a sold-out variant (`apps/web/src/features/product/quantity.ts`); it is lifted from `QuantityStepper` (controlled from artikel 12) into `ProductDetail`, which needs it for the subtotal.
- **Lists:** `key={product.id}`, never the index.
- **`memo` and `useCallback` once:** `memo(ProductCard)` with a stable `showProduct` from `useCallback` in `App`, so "Muat lebih banyak" does not re-render the cards already on screen. `showCatalog`, the subtotal and the hooks' derived values use neither; reach for them when React DevTools' Profiler shows a slow or needless render.
- **`formatRupiah`** (`packages/shared/src/lib/money.ts`): one `Intl.NumberFormat("id-ID")` for IDR with no fraction digits, shared by the whole app; the space after "Rp" is a non-breaking space.
- **Product photos are out of scope on purpose.** The API has sent a required `images` field on every product since Bab 6; Bab 8 does not read it, and every card and product page shows the "Belum ada foto" placeholder. Reasons (rebase review):
  - the chapter's 15 topics are React fundamentals and none is about images; images are named in Bab 11 ("Optimasi gambar dan Core Web Vitals", in the chapter that rebuilds the product page with Next.js SSR/ISR) and Bab 12 (admin upload with preview);
  - showing them properly needs `srcset` and `sizes` from each image's `variants` and the storage origin in the web container's CSP: locally photos are served over `http://localhost:8333`, which `img-src 'self' data: https:` blocks, and the CSP violation would fail the e2e suite. Half a solution would teach the wrong version first;
  - nothing wrong reaches the course's own stack: the seed writes no photos, and the UI, the types and the e2e suite agree.
- **Tests:**
  - `apps/web/src/test/fake-api.ts` builds products for the unit tests through the real client over a fake `fetch`;
  - `e2e/tests/dev-warnings.spec.ts` starts the Vite dev server, walks the same flows as the other specs, and fails on any console error or warning, because React's development warnings (such as a missing or duplicate `key`) are stripped from the production bundle the web container serves. The dev server's origin is not one the API's CORS allows, so Playwright passes each API call to the real API and adds `Access-Control-Allow-Origin` to the answer;
  - `e2e/support/catalog.ts` reads the contract with plain `fetch`, not `@goshop/shared`, so the storefront is checked against the API, not against itself.

## Notes

- **Bab 7 deferral delivered here:** the web chain is rebased onto `bab-7` and `make gen-types-check` stays green; the rebase review regenerated `schema.gen.ts` and got a byte-identical file. The other Bab 7 deferrals (the CSP's `img-src`, storage and the worker in `apps/web/README.md`'s dev setup) belong to the chapter that shows photos, so they move to Bab 11 (Deferred).
- **Rebases:**
  - the chapter was built and gated on `bab-8-wip`, stacked on `bab-7-wip` while that was based on `bab-4`;
  - onto `bab-5` with `bab-7-wip` (as `99d315c` on `6315081`): the three re-review suggestions were applied (above); every commit passed typecheck, lint, build, unit tests and the secret scan, and `make test-integration` in an isolated stack passed 41 e2e tests, 0 skipped;
  - onto `bab-7` (`e2b023c`: Bab 7 verified `0c3b889` plus its record): the range-diff pairs all 35 commits 1:1 and in order; 32 are identical and 3 changed (`git range-diff bab-7-wip..bab-8-wip bab-7..bab-8`). `bc3b1cc` (feat artikel-03) changes only context: its `packages/shared/src/index.ts` export sits on Bab 7's multi-line export with `SERVER_ERROR_CODES`, which survives in every later commit. `48d00bf` (`apps/web/src/test/fake-api.ts`) and `4d66e3f` (`packages/shared/src/api/catalog.test.ts`) add `images: []` to their product fixtures, because Bab 6 made `Product.images` required. The whole-chapter diff touches the same 57 files and is exactly 2 insertions larger;
  - the round-3 review checked a clean copy of `aca93ff` read-only: typecheck, unit tests (157/157 shared, 176/176 web) and lint pass; Bab 7's `errors.ts` and its contract test are untouched;
  - then `885b2d6` and `212eed3` (A1–A3) were added on top.
- **Contract:** for the two endpoints the storefront reads (`GET /v1/products`, `GET /v1/products/{slug}`), Bab 6's only change is the required `Product.images: ProductImage[]`; `ProductVariant`, `Money`, `Category`, `ProductList`, `ProductDetail` and the list query are unchanged. No cast in `apps/web` or `packages/shared` builds a product without `images`.
- **Review notes, no action:** ADR 0007's "images are visible on the storefront only after the worker has processed them" describes the API, not `apps/web`; the note in `docs/web/README.md` resolves the ambiguity and the ADR needs no change.
- **Orchestrator authority:**
  - during the rebase onto `bab-7`, the `images: []` lines went into test-owned `apps/web/src/test/fake-api.ts` (`48d00bf`) and `packages/shared/src/api/catalog.test.ts` (`4d66e3f`), a mechanical edit so that each commit compiles against Bab 6's contract;
  - the stage 1 fix and the stage 4 fixes were folded into the commits they belong to (`faf4f63`, `c61f6f5`, `b72d7b9`, `88b54d1`, `d862d92`), so each commit shows its final code;
  - no `Makefile`, Compose, workspace or catalog change in this chapter; the test commits touch only tests, test setup, the coverage config (`apps/web/vite.config.ts` leaves out the types-only `async-state.ts`) and `e2e/**`;
  - none of these lets a test agent change production code.

## Deferred

- **Product photos (Bab 11; Bab 12 for admin previews)**, as the rebase review lists them:
  - `ProductImage` takes the API's `ProductImage` (or `undefined`) instead of `src`: `src={image.url}`; `srcSet` from `image.variants` as `` `${v.url} ${v.width}w` ``, narrowest first; a `sizes` value for each layout (the grid column on the card, the detail column on the product page); `width`/`height` from the image, against layout shift; `alt={image.alt || productName}`, the contract's rule for an empty `alt`; `loading="lazy"` on cards and an eager, high-priority main image on the product page (LCP); the placeholder kept for `images.length === 0`;
  - call sites: `ProductCard.tsx` and `ProductDetail.tsx` pass `product.images[0]` (or the product page renders a small gallery of all `images` in order); `.product-image` in `index.css` needs `aspect-ratio`/`object-fit` for real photos;
  - CSP and build: allow the storage's public origin in `img-src`, for example through a build argument such as `VITE_IMAGE_ORIGIN` that `apps/web/Dockerfile` writes into a file the Caddyfile reads, as `api-origin` is handled (Compose: `http://localhost:8333`); tighten `https:` to that exact origin in production; update the expected CSP in `e2e/tests/csp.spec.ts` and `e2e/tests/web-container.spec.ts`; for Next.js, `images.remotePatterns` for the same host;
  - tests: a fake-api fixture with one ready image; `ProductCard` and `ProductDetail` render an `img` with `src`, `srcset`, `width`, `height` and the `alt` fallback, and the placeholder for `images: []`; `catalog-cards.spec.ts` asserts the placeholder only when `product.images` is empty and the photo otherwise (the e2e `ProductRow` already has `images`, `212eed3`); a seeded or fixture product with a `ready` image, so the photo path runs against the real API and CSP, which needs storage and the worker in the e2e stack, or a ready row and objects inserted by the test;
  - `apps/web/README.md`: `make dev-api` with postgres and redis is enough until then; storage and the worker are needed once the page shows photos (carried from Bab 7).
- **Category filter:** the artikel-15 challenge (`docs/web/README.md`); `useProducts` already starts a new list when its filters change. Bab 9 moves the chosen category into the URL.
- **Bab 9 (web):** React Router replaces `selectedSlug`, TanStack Query replaces `useProducts`/`useProduct`; rebase onto `bab-8` and keep `make gen-types-check` green.
- **Bab 10 (web):** Tailwind and shadcn/ui replace `index.css`.

## Articles → code

Each code article has a `feat` commit and unit tests; where the browser or the running API matters, e2e tests too.

| Artikel | Topic | feat | tests (unit, e2e) |
|---|---|---|---|
| 01 | What React is: declarative, components, virtual DOM | conceptual: `30caa13` (docs) | — |
| 02 | JSX and its rules | `faf4f63`, `885b2d6` (docs: photos ignored until Bab 11) | `84be735` |
| 03 | Components and props: `ProductCard` | `bc3b1cc` | `48d00bf`, `d0b176a` (e2e), `212eed3` (e2e) |
| 04 | Composition and `children` | `90045b0` | `5bff69b` |
| 05 | State with `useState`: the quantity stepper | `f755a5a` | `809e61e`, `1b68e99` (e2e) |
| 06 | Event handling | `a7049d5` | `7ec761e`, `0a54a13` (e2e) |
| 07 | Lists and `key` | `c61f6f5` (with the B1 comment) | `2315e74`, `aca93ff` (e2e, React dev warnings) |
| 08 | Conditional rendering: loading, empty, error | `8555c18` | `d9f1a4e`, `38ef1e0` (e2e) |
| 09 | `useEffect` and how not to misuse it | `3df3f15` | `5a3d5be` |
| 10 | Fetching the catalog from the GoShop API | `f6a6247` | `4d66e3f`, `a37f98f` (e2e) |
| 11 | Custom hook: `useProducts` | `b72d7b9` (with the A → B → A fix) | `c87bd70`, `d0ee653` (e2e) |
| 12 | Lifting state up and one-way data flow | `88b54d1` | `a77d6bc`, `215b7aa` (e2e) |
| 13 | `useMemo`, `useCallback`, and when they are not needed | `02d206a` | `25d2642` |
| 14 | React DevTools for debugging | conceptual: `5d03bbf` (docs) | — |
| 15 | Recap + challenge: a category filter in the catalog | `d862d92` (docs) | — |

Cross-article: none; the Bab 8 section of `docs/web/README.md` grows in articles 01, 02, 14 and 15.
