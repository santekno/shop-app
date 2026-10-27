# JavaScript and TypeScript for Go developers

Bab 7 teaches the JavaScript and TypeScript that the GoShop web code uses every day. This note is the map: what changes when you come from Go, and where each idea lives in the code.

## The mental model

| Go | JavaScript / TypeScript | What it means in GoShop |
|---|---|---|
| Types are checked by the compiler **and** exist at run time | TypeScript types are checked by `tsc`, then **erased**; the browser runs plain JavaScript | A response is only as correct as the API. Types come from `api/openapi.yaml`, never written by hand |
| `go build` produces one binary | Vite bundles modules into static files; Node 24 can run a `.ts` file directly by stripping its types | `packages/shared` has no build step: apps and Node import its `.ts` source |
| `int`, `int64`, `float64` are different types | `number` is always a 64-bit float; integers are exact only up to `Number.MAX_SAFE_INTEGER` (2^53 − 1) | Money is whole rupiah (`amount`), far below 2^53, so a `number` holds it exactly |
| Every variable has a zero value | A missing value is `undefined`, an explicit "nothing" is `null` | The API sends `null` (`parent_id`, `next_cursor`); optional fields in our options are `undefined` |
| `==` compares values of one type | `==` converts types first (`0 == ""` is `true`); `===` does not | Always `===`, enforced by the `eqeqeq` lint rule |
| Errors are values: `v, err := f()` | Errors are thrown and caught with `try`/`catch`; a rejected promise is an error | The API client throws one error type, `ApiError`, for every failure |
| Goroutines run in parallel on many threads | One thread runs an **event loop**; `await` yields until a promise settles | No locks, but never block the thread with long synchronous work |
| `context.Context` cancels work | `AbortController` / `AbortSignal` cancel a `fetch` | Every client call takes a `signal`; timeouts abort the request |
| Packages, `import "path"` | ES modules, `import { x } from "./file.ts"` | One public entry point per package (`packages/shared/src/index.ts`) |
| Methods on structs, interfaces satisfied implicitly | Functions and objects; TypeScript types are **structural** too | The client is a plain object returned by a function, not a class hierarchy |

## Where each article's ideas live

Every concept of Bab 7 is in code the storefront runs, not in a sandbox. Paths are relative to the repository root.

| Article | Concept | Where to read it |
|---|---|---|
| 01 | The mental model above | this file |
| 02 | `const`, arrow functions, closures | `createUrlBuilder` in `packages/shared/src/api/url.ts` (the returned function closes over the checked base URL); `let` only where a value changes: the loop counter in `retry` (`packages/shared/src/lib/async.ts`) |
| 03 | Destructuring, default parameters, spread, rest | `for (const [key, value] of Object.entries(query))` and `query = {}` in `url.ts`; option destructuring with defaults in `createApiClient` and `request` (`packages/shared/src/api/client.ts`); `{ ...init, signal }` in `send`; `...codes` rest parameter in `isApiError` (`packages/shared/src/api/errors.ts`) |
| 04 | `map`, `filter`, `reduce` | `buildCategoryTree` in `packages/shared/src/catalog/category-tree.ts`; `nodes.map` rendering in `apps/web/src/features/catalog/components/CategoryTree.tsx` |
| 05 | ES modules: `import`/`export`, `import type`, one entry point | `packages/shared/src/index.ts`, `"exports"` and `"sideEffects"` in `packages/shared/package.json`; `@goshop/shared` imports in `apps/web/src` |
| 06 | Promises, `async`/`await` vs goroutines | `sleep` (a promise built by hand, abortable like `select` on `ctx.Done()`) and `retry` (`return await` inside `try`) in `async.ts`; the effect in `apps/web/src/features/catalog/hooks/useCategoryTree.ts` |
| 07 | `fetch`, error handling, timeouts | `send`/`readResponse` in `client.ts` (`AbortController` per attempt, `finally` as `defer`); the `ApiError` class and the `isErrorBody` run-time check in `errors.ts`; `errorMessage` in `apps/web/src/lib/error-message.ts` |
| 08 | `type`, `interface`, unions, narrowing | `HttpMethod` in `client.ts`; `ServerErrorCode`, `ClientErrorCode`, `ApiErrorCode` and the `isApiError` type guard in `errors.ts`; the `AsyncState<T>` discriminated union in `useCategoryTree.ts` |
| 09 | Generics vs Go generics | `retry<T>` in `packages/shared/src/lib/async.ts` (T flows in from the function argument) vs `request<T>` in `client.ts` (T only in the result: a promise the caller makes); `AsyncState<T>` in `useCategoryTree.ts` |
| 10 | `Partial`, `Pick`, `Omit` (and `Readonly`, `ReturnType`) | `ApiClientOptions`, `DEFAULTS`, `RequestOptions` and `ApiClient` in `client.ts`; `EndpointOptions` in `packages/shared/src/api/catalog.ts` |
| 11 | Types generated from OpenAPI | `packages/shared/src/api/schema.gen.ts` (never edited), the aliases in `types.ts`, `listCategories` in `catalog.ts`; `make gen-types` writes it, `make gen-types-check` (part of `make lint`) fails when it is stale |
| 12 | Vite + React + TS project | `apps/web`: `vite.config.ts` (alias, port 5173, the `VITE_API_URL` build check), `tsconfig.app.json`, `src/config.ts`, `src/vite-env.d.ts`; container in `apps/web/Dockerfile` and `apps/web/Caddyfile` |
| 13 | ESLint, Prettier, team rules | `apps/web/eslint.config.js`, `packages/shared/eslint.config.js`, the `lint`/`format`/`test:unit` scripts |
| 14 | Asking AI to explain confusing JS | no code; `docs/ai-rules.md` |
| 15 | Recap: a typed GoShop API client | `createApiClient` + `listCategories`, used by `apps/web/src/lib/api.ts` and `useCategoryTree` |

## Running a file directly

`packages/shared` has no build step. Node 24 strips the types and runs a `.ts` file as it is, which is handy for trying an idea from an article:

```bash
node -e 'import("./packages/shared/src/index.ts").then(({ buildCategoryTree }) =>
  console.log(buildCategoryTree([{ id: "1", slug: "a", name: "A", parent_id: null }])))'
```

That works because the package only uses syntax that disappears when types are removed (`erasableSyntaxOnly`: no `enum`, no `namespace`) and names every relative import with its `.ts` extension.

# Bab 8: React for Go developers

Bab 8 builds the storefront's catalog and product pages in plain React: components, props, state and effects, with no router, no data-fetching library and no CSS framework yet. Bab 9 adds React Router and TanStack Query, Bab 10 Tailwind and shadcn/ui; this chapter's code is written so that each of them replaces one clearly marked piece.

Product photos are left out on purpose. The API has sent `images` with every product since Bab 6, but Bab 8 ignores the field, so every card and product page shows the "Belum ada foto" placeholder, even for a product you gave a photo in Bab 6. Showing them properly needs `srcset` and `sizes` built from each image's `variants`, and the storage origin allowed in the web container's CSP (`img-src`). Bab 11 adds both, with image optimisation.

## The mental model

| Idea | What it means | Go comparison |
|---|---|---|
| **Declarative** | A component describes what the screen should look like for the current data (`state.status === "loading" ? … : …`); React works out which DOM changes get it there | Like an `html/template`: you write the page for the data, not the steps that edit the previous page |
| **Components** | Functions that take props and return JSX. A page is a tree of them: `App` → `CatalogPage` → `ProductGrid` → `ProductCard` | Small functions composed into bigger ones; props are the parameters |
| **Re-rendering** | When state changes, React calls the component function again and compares the new result with the old one | Calling the template again; the function must not have side effects while it runs |
| **Virtual DOM** | The JSX result is a cheap tree of plain objects; React diffs it against the previous tree and touches the real DOM only where they differ | Computing a diff before writing, instead of rewriting the whole page |
| **One-way data flow** | Data goes down as props; changes go up as callbacks (`onSelect`, `onChange`) to the component that owns the state | A function receives values and returns results; it does not reach into its caller's variables |
| **Effects** | Code that talks to the world outside React (the network, `document.title`) runs in `useEffect`, after the render, and cleans up after itself | A goroutine started with a `context` that is cancelled when the work is no longer needed |

## Debugging with React DevTools

Install the React Developer Tools extension (Chrome, Firefox or Edge) and open the storefront from `pnpm --filter @goshop/web dev`. Two new tabs appear in the browser's developer tools.

**Components** shows the component tree, not the DOM: `App` → `CatalogPage` → `Section` → `ProductGrid` → `ProductCard`.

- Select `App` to see its `selectedSlug` state. Click a product and watch it change, then switch to `ProductDetailPage` and read its `slug` prop.
- Select a `ProductCard` to see its `product` prop as plain data. That is the quickest way to answer "what did the API actually send?" without opening the Network tab.
- Hooks are listed by their order in the component. In `ProductDetail` the first `State` is the variant id and the second is the quantity. You can edit a value in place to try a state the UI cannot reach easily, such as a quantity above the stock.
- The eye icon jumps to the DOM element; the `<>` icon jumps to the component's source.

**Profiler** records what rendered and why.

- Start recording, click "Muat lebih banyak", then stop. With "Record why each component rendered" turned on in the settings, the cards that were already on screen show "Did not render": that is `memo(ProductCard)`, with each `product` keeping its identity. `App` does not render here (`CatalogPage` owns the list), so `onSelect` is unchanged even without `useCallback`. Now record opening a product and going back: `App` renders, and the cards still show "Did not render" because the `useCallback` keeps `onSelect` the same. Remove the `useCallback` and record that again: every card renders, because its `onSelect` prop changed.
- Use it before adding `useMemo` or `useCallback` anywhere else. If a component is not slow and does not render for nothing, leave it as it is.

**Two things that look like bugs but are not:**

- In development every effect runs twice on mount: `StrictMode` (in `main.tsx`) mounts, unmounts and mounts again to show missing cleanups. The Network tab shows a first request "(canceled)": that is our `AbortController` doing its job. Production builds mount once.
- Logs inside a component appear twice for the same reason: StrictMode also renders twice in development, to catch side effects during rendering.

## Where each Bab 8 article's ideas live

Paths are relative to `apps/web/src` unless they start with `packages/`.

Articles 03–09 build components and hooks one at a time: `ProductCard`, `Card`, `Section`, `QuantityStepper`, `VariantPicker`, `ProductGrid`, the status components and `useDocumentTitle`. They first appear on screen at artikel 10, when `CatalogPage` and `ProductDetailPage` put them together; `App` gets its final shape at artikel 12. If you check out an earlier `bab-8` commit, you will find these files in the code but not yet on the page.

| Article | Concept | Where to read it |
|---|---|---|
| 01 | Declarative UI, components, virtual DOM | the mental model above |
| 02 | JSX and its rules | `app/SiteHeader.tsx` (`className`, one root, closed tags), `features/catalog/components/ProductImage.tsx` (`{…}` expressions, camelCase SVG attributes, `aria-hidden`, early return), the fragment in `app/App.tsx` |
| 03 | Components and props | `features/catalog/components/ProductCard.tsx` (typed `ProductCardProps`, destructuring the API's snake_case fields); `formatRupiah` in `packages/shared/src/lib/money.ts` |
| 04 | Composition and `children` | `components/ui/Card.tsx` (`children`, the `as` prop as a tag), `components/ui/Section.tsx` (composes `Card`, `useId` for `aria-labelledby`), used by `CategorySection`, `CatalogPage`, `ProductCard` and `ProductDetail` |
| 05 | State with `useState` | the first `QuantityStepper` (artikel-05 commit): `useState(1)`, updater functions, the clamped value derived during render; bounds in `features/product/quantity.ts` |
| 06 | Event handling | `onClick` passing a function, not calling it (`ProductCard`), a typed `ChangeEvent<HTMLInputElement>` in `features/product/components/VariantPicker.tsx` (a controlled radio group) |
| 07 | Lists and `key` | `features/catalog/components/ProductGrid.tsx` (`key={product.id}`, never the index), `VariantPicker`, `CategoryTree` |
| 08 | Conditional rendering | `components/ui/StatusMessage.tsx` (`LoadingState`, `EmptyState`, `ErrorState`; the `0 &&` trap), `CatalogPage`'s footer, `ProductDetailPage` (NOT_FOUND vs other errors) |
| 09 | `useEffect`, and what it is not for | `hooks/useDocumentTitle.ts` (sync with `document.title`, cleanup restores it; the list of non-uses); every fetch effect aborts on unmount; `ProductDetail` starts its state from the loaded product instead of copying it in an effect |
| 10 | Fetching the catalog | `listProducts` and `getProduct` in `packages/shared/src/api/catalog.ts` (`encodeURIComponent` on the slug), `ListProductsQuery` in `packages/shared/src/api/types.ts`; the inline effects of the artikel-10 commit |
| 11 | Custom hooks | `features/catalog/hooks/useProducts.ts` (cursor pagination, `loadMore`, `retry`, new filters derived as a new list), `features/product/hooks/useProduct.ts` |
| 12 | Lifting state up, one-way data flow | `selectedSlug` in `app/App.tsx` shared by `SiteHeader`, `CatalogPage` and `ProductDetailPage`; on the way back, `App` gives the focus to the card that was opened (a ref and an effect), which also scrolls it into view; the quantity lifted from `QuantityStepper` (now controlled) into `ProductDetail`, kept within the stock by the variant handler `selectVariant` |
| 13 | `useMemo`, `useCallback`, `memo` | `memo(ProductCard)` with the `useCallback` of `showProduct` in `App`; why `showCatalog`, the subtotal and the hooks' derived values need neither |
| 14 | React DevTools | the section above |
| 15 | Recap | this table, and the challenge below |

### The Bab 7 challenge, answered

Bab 7 ended with a challenge: write `listProducts` yourself. Bab 8 needs it, so `packages/shared/src/api/catalog.ts` now ships the official version, together with `getProduct`. Compare it with yours. It returns the whole `{ data, page }` body, because the caller needs `page.next_cursor`. It takes its query as the generated `ListProductsQuery`, so a misspelt filter is a compile error.

### Challenge: filter the catalog by category

The API already filters: `GET /v1/products?category=kaos` returns products of that category and its sub-categories. Make the category list in the sidebar do it:

1. Turn each name in `CategoryTree` into a button that reports its category's `slug` upwards (props and events, artikel 03 and 06).
2. Keep the chosen slug where both the sidebar and the product list can reach it (lifting state up, artikel 12).
3. Pass it to `useProducts({ category, limit })`. The hook already starts a new list when its filters change; read how in `useProducts.ts` (artikel 11).
4. Show which category is active, and add a way back to "Semua produk" (conditional rendering, artikel 08).
5. Mind the focus on the way back from a product. `App` gives it to the card that was opened, but once the list can change, that card may be gone: the buyer picked another category before returning. Then nothing matches the selector and focus stays on `<body>`. Fall back to the "Produk" heading (give it `tabIndex={-1}` so it can take focus).

Bab 9 moves the chosen category into the URL, so that a filtered catalog can be bookmarked and shared.

# Bab 9: routing, server state and forms

Bab 9 turns the one-page catalog into a storefront with many pages. The URL decides which page shows (React Router), the data from the API lives in a cache that every page shares (TanStack Query), and the login and registration forms check their input with the same rules as the API (React Hook Form and Zod).

The Bab 7 and Bab 8 tables above describe the code as those chapters left it (branches `bab-7` and `bab-8`). The sections below say what Bab 9 replaced.

## The mental model

| Idea | What it means | Go comparison |
|---|---|---|
| **The URL is state** | Which page, which product, which filter: all of it is in the address (`/produk/kaos-polos-hitam`, `/?kategori=kaos&urut=termurah`). It survives a reload, can be shared, and moves with Back and Forward | A `chi` router: the path picks the handler, `chi.URLParam` and `r.URL.Query()` read the inputs |
| **Nested routes and layouts** | A route renders its children through `<Outlet />`: `RootLayout` (the header) wraps every page, `AuthLayout` wraps `/masuk` and `/daftar` | `r.Route("/v1", …)` with middleware that wraps every handler inside it |
| **Server state is a cache** | Data from the API is a copy that can go out of date. TanStack Query keeps one entry per query key, shares it between components, refetches stale entries, and forgets unused ones | A read-through cache in front of a service, with eviction (`gcTime`). `staleTime` is not a TTL: stale data is still served at once, while a refetch runs in the background (stale-while-revalidate); it only decides when that refetch happens |
| **Mutations invalidate or update the cache** | After a POST, the cached copies of what it changed are out of date: mark them stale (`invalidateQueries`) or write the answer in (`setQueryData`) | Deleting or updating the cache key after a write |
| **A form is checked twice** | The browser checks first (Zod, fast and in Indonesian), the API checks again and has the last word; its answer lands on the same fields | The handler's validation is the real one; a client check only saves a round trip |

## Decisions

- **React Router v7 in data mode, without the framework.** `createBrowserRouter(routes)` in `app/App.tsx`, the routes as an array in `app/routes.tsx`, rendered by `<RouterProvider>` from `react-router/dom`. Data mode gives the APIs the chapter uses (`lazy`, `ErrorBoundary`, `HydrateFallback`, `useNavigation`, `ScrollRestoration`) without the framework mode's build plugin and file conventions: Bab 11 moves the storefront to Next.js, which has its own. Loaders are not used: TanStack Query owns server data, and a second place to fetch it would only blur that.
- **One layer retries.** The API client (`lib/api.ts`) already retries a GET twice when retrying can help (network failure, timeout, 502/503/504). TanStack Query would retry every failed query 3 more times on top, up to 12 requests and about a minute of "Memuat…" against an API that is down, and it would also retry errors that never pass (404, 400). So `retry: false` for queries in `lib/query-client.ts`. Mutations are never retried (a POST sent twice adds twice). `staleTime` is 30 seconds (5 minutes for categories), instead of TanStack's 0.
- **The abort signal still reaches `fetch`.** Every `queryFn` passes TanStack Query's `signal` to the shared client, as Bab 8's effects passed their `AbortController`'s: a request nobody waits for is aborted.
- **Tokens stay in memory in Bab 9.** The guest cart token lives in React state (`features/cart/CartTokenProvider.tsx`), the session (account and access token) too (`features/auth/SessionProvider.tsx`). A reload forgets both: the buyer starts with an empty cart and logged out. The refresh token from `POST /v1/auth/login` is not kept at all (`useLogin` drops it inside `mutationFn`, so not even the mutation's cached `data` holds it, and `gcTime: 0` drops the finished login and register mutations, whose variables hold the password), nothing refreshes the access token, and no request sends it yet. Never `localStorage` for tokens (ADR 0005). **Bab 10** builds the real thing: a Zustand store that keeps the cart token across reloads, the access token on the requests that need it, one refresh at a time before it expires, logout through `POST /v1/auth/logout`, the guest cart merged into the user's after login (`POST /v1/cart/merge`), and pages that need a login.
- **The optimistic update changes only what is on screen.** Adding to the cart raises the header's count, the subtotal and an existing line's quantity at the click (`features/cart/optimistic-cart.ts`). A variant that is not in the cart yet gets no guessed line: a line needs data only the server has, and no page that lists lines is on screen while adding. The API answers with the whole cart, which replaces the guess. On an error the snapshot is put back and the message says why (409 `INSUFFICIENT_STOCK`, `QUANTITY_LIMIT`, `CART_FULL`, `VARIANT_UNAVAILABLE`). Every add runs in one queue (`scope: { id: "cart" }`), so two adds never overlap, even from two mounts of the product page: the second reads the guest token the first created instead of creating a second cart. After the last add of a burst settles, the cart is fetched once more, so the cache ends with the server's word. A `GET /v1/cart` that answers `CART_NOT_FOUND` forgets the token, and the buyer sees an empty cart instead of a retry that can never succeed.
- **Zod schemas live in `packages/shared`** (`src/schemas/auth.ts`), beside the API client, so the web and mobile apps check the same rules. They follow what the API really checks (`apps/api/internal/auth/handler.go` and `password.go`): a trimmed ASCII email up to 254 characters, a password of 8 to 128 characters counted as Go counts them (code points, not UTF-16 units) and not only spaces, a trimmed name up to 100 characters. The list of common passwords stays on the server; its refusal arrives as a field error (artikel 11). `satisfies z.ZodType<RegisterRequest>` ties each schema to the type generated from the contract.
- **Still no product photos.** The API has sent `images` since Bab 6, but the catalog, product page and cart keep Bab 8's "Belum ada foto" placeholder on purpose; a product given a photo in Bab 6 still shows it. Bab 11 adds the photos (`srcset` from each image's `variants`, the storage origin in the CSP's `img-src`).

## What replaced Bab 8's hand-written code

| Bab 8 | Bab 9 | Why |
|---|---|---|
| `selectedSlug` state in `App`, `onSelect` callbacks, `useCallback` | routes and `<Link>`s; `useParams` in `ProductDetailPage` | a product has a URL: it can be reloaded, shared, opened in a new tab, and reached with Back |
| the catalog kept mounted but `hidden`, to keep its pages | `useInfiniteQuery`'s cache | the loaded pages survive leaving the catalog, without keeping a hidden page alive |
| `App`'s `returnFocusTo` ref and effect | `app/useRouteFocus.ts` | focus is handled for every navigation, Back and Forward included, not only for "Kembali" |
| `useCategoryTree` (effect, `AbortController`, `AsyncState`, `attempt`) | `useQuery(categoriesQuery())` with `select: buildCategoryTree` | one shared request and cache entry; retry is `refetch` |
| `useProduct` | `useQuery(productQuery(slug))` in `ProductDetailPage` | a product opened before shows at once; the same options serve the prefetch |
| `useProducts` (pages, cursor, phase, key compared while rendering) | `useProductList` → `useInfiniteQuery(productListQuery(filters))` | the filters are the key; `getNextPageParam` reads `next_cursor`; the same-cursor guard moved there |
| `lib/async-state.ts` | TanStack Query's `status` and `fetchStatus` | the union now comes from the library |
| "Muat lebih banyak" only | an IntersectionObserver sentinel, with the button kept | the list grows by scrolling; the button stays for keyboards and where the observer is missing |

## Where each article's ideas live

Paths are relative to `apps/web/src` unless they start with `packages/`.

| Article | Concept | Where to read it |
|---|---|---|
| 01 | Routes, layouts, nested routes | `app/routes.tsx` (the route tree, the pathless `AuthLayout`, `*`), `app/App.tsx` (`createBrowserRouter`, `RouterProvider`), `app/RootLayout.tsx` (`<Outlet />`, `ScrollRestoration`), `app/SiteHeader.tsx` (`Link`, `NavLink` and `aria-current`), `app/useRouteFocus.ts`, `features/auth/components/AuthLayout.tsx` |
| 02 | A page from a URL parameter | `features/product/components/ProductDetailPage.tsx` (`useParams`, the back link that returns to the list it came from), `features/product/paths.ts` (`PRODUCT_ROUTE`, `productPath`, `FROM_CATALOG`), the card link in `features/catalog/components/ProductCard.tsx`, the card focus in `app/useRouteFocus.ts` |
| 03 | Search params for filters | `features/catalog/catalog-filters.ts` (reading the URL as untrusted input, writing it back), `CatalogPage.tsx` (`useSearchParams`, `UNKNOWN_CATEGORY`), `CatalogToolbar.tsx` (search and sort), `CategorySection.tsx` and `CategoryTree.tsx` (category links). The cursor stays out of the URL: see `CatalogPage`'s comment |
| 04 | Server state, the QueryClient | `lib/query-client.ts` (defaults and why), the provider and devtools in `app/App.tsx` |
| 05 | `useQuery`: cache, stale time, refetch | `features/catalog/api/queries.ts` (query keys, `queryOptions`, the signal), `features/catalog/hooks/useCategoryTree.ts` (`select`), `features/catalog/components/CategorySection.tsx` (`status` vs `isFetching`), `features/product/api/queries.ts`, `ProductDetailPage.tsx` |
| 06 | `useMutation` and invalidation | `packages/shared/src/api/cart.ts`, `features/cart/` (`cart-token-context.ts`, `CartTokenProvider.tsx`, `api/queries.ts`, `hooks/useCart.ts`, `components/AddToCart.tsx`, `components/CartNavLink.tsx`, `components/CartPage.tsx`, `cart-errors.ts`); the artikel-06 commit of `hooks/useAddToCart.ts` invalidates |
| 07 | Infinite scroll | `productListQuery` in `features/catalog/api/queries.ts` (`initialPageParam`, `getNextPageParam`), `features/catalog/hooks/useProductList.ts`, `hooks/useOnVisible.ts` (IntersectionObserver, `useEffectEvent`), `features/catalog/components/ProductListFooter.tsx` |
| 08 | Optimistic update | `features/cart/hooks/useAddToCart.ts` (`onMutate` snapshot and guess, `onError` rollback, `onSuccess` with the server's cart and a new token, `onSettled` refetch, `scope` queue and `getCartToken` from `CartTokenProvider`), `features/cart/optimistic-cart.ts` |
| 09 | React Hook Form | `features/auth/components/LoginPage.tsx` and `RegisterPage.tsx`, `components/ui/TextField.tsx` (label, `aria-describedby`, `aria-invalid`, `ref` as a prop), `features/auth/hooks/`, `session-context.ts`, `SessionProvider.tsx`, `components/AccountNav.tsx`, `navigation-state.ts`; `packages/shared/src/api/auth.ts`. The artikel-09 commit uses React Hook Form's built-in rules |
| 10 | Zod, shared with the API types | `packages/shared/src/schemas/auth.ts` (`satisfies`, characters counted as Go counts them), `zodResolver` in both pages |
| 11 | The API's errors on the form | `lib/api-form-errors.ts` (`setApiFieldErrors`, the Indonesian wording), `onError` in `LoginPage` and `RegisterPage` (`EMAIL_TAKEN`, `INVALID_CREDENTIALS` as a `root` error, shown by `components/ui/FormAlert.tsx`, which takes the focus), `features/auth/auth-errors.ts` |
| 12 | Error boundary and 404 | `app/RouteErrorPage.tsx` (`useRouteError`, `isRouteErrorResponse`), `ErrorBoundary` in `app/routes.tsx`, `app/NotFoundPage.tsx`, `throwOnError` in `ProductDetailPage.tsx`, `hooks/useLateHeadingFocus.ts`; `lib/report-error.ts` as `RouterProvider`'s `onError` (`app/App.tsx`), with React's `onCaughtError` left silent (`main.tsx`): each caught error is reported once, and the expected NOT_FOUND not at all |
| 13 | Lazy routes, code splitting | `lazy` in `app/routes.tsx`, `features/product/lazy.ts`, `features/auth/lazy.ts`, `app/NavigationProgress.tsx`, `app/AppLoading.tsx` (`HydrateFallback`). `pnpm --filter @goshop/web build` lists one file per lazy page plus two shared chunks: one with React Hook Form and Zod, used by both auth pages (Rollup names a shared chunk after one of its modules, here `navigation-state`), and `useMutation`, used by the auth pages and the product page |
| 14 | Prefetch on hover | `features/product/hooks/usePrefetchProduct.ts` (on hover with a mouse only, after 100 ms; on focus, which in Chromium a mouse press or a tap also gives a link a moment before the click (not in Safari or Firefox), at no extra request since the click makes the same ones), used by `ProductCard`. It calls `queryClient.query`, the newer name of `prefetchQuery`, which TanStack Query 5.10x marks deprecated |
| 15 | Recap | this section, and the challenge below |

## Accessibility notes

- After a navigation the focus moves to the new page's `<h1>` (every page has one, `tabIndex={-1}`), or back to the card of the product the buyer came from; a page whose heading arrives with its data takes it over from `<main>` (`useLateHeadingFocus`). A change of query string (a filter, the sort) leaves the focus on the control in use.
- Form errors are linked to their inputs with `aria-describedby` and mark them `aria-invalid`; the first invalid field gets the focus, whether the error came from Zod or from the API. An error that belongs to no field (`INVALID_CREDENTIALS`, the network) takes the focus itself (`components/ui/FormAlert.tsx`), since the disabled submit button lost it.
- Live regions are rendered before their text changes: "Ditambahkan ke keranjang", "Memuat halaman…".

## The Bab 8 challenge, answered

Bab 8 ended with a challenge: filter the catalog by category. Bab 9 ships one, and moves the choice into the URL as promised: each category in the sidebar is a link to `/?kategori=<slug>` (`CategorySection` and `CategoryTree`), "Semua produk" removes it, and `aria-current="true"` marks the active one. The focus problem from step 5 of the challenge is solved by `useRouteFocus`: when the card is gone, the page heading takes the focus.

## Challenge: a product search page

The API already searches: `GET /v1/products?q=…` matches names and descriptions with PostgreSQL full-text search (Indonesian stemming), and combines with `category` and `sort`. The catalog accepts `?q=`, but a search deserves its own page.

1. Add a route `/cari` to `app/routes.tsx`, lazy like the product page (artikel 01 and 13).
2. Put a search box in `SiteHeader`, a `<form role="search">` that navigates to `/cari?q=…` on submit (artikel 03). Keep the text when the page reloads.
3. On the page, read `q` with `useSearchParams` and list the results with `useProductList({ q, limit })`. A different `q` is a different query key, so earlier searches come back from the cache (artikel 05 and 07).
4. Without `q`, show a hint instead of the whole catalog; with no results, say so and suggest removing a word (artikel 08 of Bab 8).
5. Prefetch on hover works on the results for free, since they are `ProductCard`s (artikel 14). Check the focus: after a search the page heading should say what was searched, and get the focus.

# Bab 10: styling, design system and global state

Bab 10 gives the storefront one consistent look and moves the state that really is global into the right place. Tailwind CSS v4 and shadcn/ui replace Bab 7–9's hand-written stylesheet, a small set of design tokens decides every colour, size and space, dark mode follows the device or the viewer's choice, and the guest cart lives in a Zustand store that survives a reload.

The Bab 7–9 sections above describe the code as those chapters left it. The sections below say what Bab 10 changed.

## The mental model

| Idea | What it means | Go comparison |
|---|---|---|
| **Utility classes** | Each class sets one property (`flex`, `gap-4`, `md:grid-cols-2`); the look is read in the markup, and Tailwind writes only the CSS the classes use | Configuration as code beside the thing it configures, instead of a global file whose effects you have to search for |
| **Design tokens** | A named decision (`--primary`, `--spacing`, `--radius`) that every utility is built from. Components use `bg-primary`, never `#0b5cad` | Constants in one package: change the value once, every caller follows |
| **Colour by role** | `primary`, `muted-foreground`, `destructive` name what a colour is for, not what it looks like, so dark mode only swaps values | An interface: callers depend on the role, the implementation (the hex value) can change |
| **Copied components** | shadcn/ui is not a dependency: its components are copied into `components/ui` and changed like our own code | Vendoring a small package you intend to edit |
| **Global vs local state** | Server data stays in TanStack Query, page state in the URL or a component; only what many distant components share, and that is no server's copy, goes in a store | A package-level variable: right for a few things, a trap for most |

## Decisions

- **Tailwind CSS v4 through its Vite plugin** (`@tailwindcss/vite`, artikel 01). No `tailwind.config.js` and no PostCSS: the theme is CSS (`@theme` in `src/index.css`), and the plugin writes one static CSS file. The Bab 7–9 rules sat in cascade layers while components moved to utilities one at a time; artikel 04 removed the last of them.
- **Mobile first** (artikel 02): the classes without a prefix are the phone; `sm:`, `md:` and `lg:` add columns as the screen grows (two product columns, three from `sm`, four from `lg`; the category list folds behind a button below `md`).
- **shadcn/ui, changed for GoShop** (artikel 03): `Button`, `Input`, `Label`, `Badge` and `DropdownMenu` in `components/ui`, plus a styled native `<select>` (`NativeSelect`). Changes from upstream: an outline focus ring instead of a box-shadow ring (it survives Windows' forced-colours mode), taller buttons (`h-10`), and `modal={false}` on the menu (below, CSP). The logged-in menu is a lazy module (`AccountMenu`), so a guest never downloads Radix.
- **Tokens** (artikel 04, `src/index.css`):
  - colour values per theme as CSS variables on `:root` (`--background`, `--primary`, `--muted-foreground` …, shadcn/ui's names), turned into utilities by `@theme inline` (`bg-primary` is `background-color: var(--primary)`, so the dark values switch every utility at once);
  - typography: the system font stack (`--font-sans`, no web font to download), and two sizes of our own beside Tailwind's scale, `text-title` (a page's `<h1>`, 1.75rem) and `text-heading` (a section's `<h2>`, 1.25rem), each with its line height;
  - spacing: `--spacing: 0.25rem`, the 4 px step every `p-*`, `gap-*` and `m-*` multiplies;
  - corners: one `--radius` (0.5rem) with `rounded-sm`, `-md` and `-lg` derived from it;
  - the page width, `--container-page` (`max-w-page`), shared by the header, the main area and the loading text;
  - the navigation bar's animation, `animate-navigation-progress`, with its keyframes inside `@theme`.
  The only plain CSS left is the element defaults in `@layer base` (`html`, `h1`, `h2`, `a`, `:focus-visible`), written with `@apply` from the same tokens. Class names such as `price`, `badge`, `cart-line` or `product-card__name` style nothing any more; they stay as hooks for the tests.
- **Contrast was measured, not guessed.** Every text colour meets WCAG 2.2 AA (4.5:1) on what it sits on, and the focus ring 3:1:

  | Pair | Light | Dark |
  |---|---|---|
  | `foreground` on `background` | 14.8 | 16.0 |
  | `foreground` on `card` | 15.8 | 14.7 |
  | `muted-foreground` on `card` | 6.1 | 5.9 |
  | `muted-foreground` on `background` | 5.7 | 6.5 |
  | `primary` (links, focus ring) on `card` | 6.7 | 5.6 |
  | `primary-foreground` on `primary` (buttons, the cart count) | 6.7 | 6.1 |
  | `destructive` on `card` | 6.6 | 6.9 |
  | `destructive-foreground` on `destructive` | 6.6 | 7.5 |
  | `success` on `card` | 5.1 | 6.8 |
  | `primary` on `accent` (a hovered link) | 5.9 | 4.5 |

  Measuring found two failures in the code before artikel 04: white text on the dark theme's blue button (`#4493f8`, 3.1:1; Bab 9's cart count had the same problem) and white on the dark theme's red, in the `destructive` button variant (2.5:1). Both themes now have their own `primary-foreground` and `destructive-foreground`.
- **Dark mode** (artikel 05): the theme follows the device (`prefers-color-scheme`) until the viewer presses the header's toggle (`features/theme/components/ThemeToggle.tsx`, a button with `aria-pressed`). The choice is `<html data-theme="light|dark">`, saved in `localStorage` under `goshop:theme`, every access wrapped in `try`/`catch` (blocked storage only means the choice is not remembered). A custom `dark` variant (`@custom-variant` in `index.css`) is dark when the attribute says so, or when the device is dark and the attribute does not say light; the dark colour values are written once, inside `@variant dark`, and Tailwind emits both selectors. Pressing the toggle shows the other theme; when that is what the device prefers anyway, the saved choice is removed and the page follows the device again (`useTheme`).
- **No flash of the wrong theme, and no inline script.** The saved choice must be on `<html>` before the first paint, so something has to run before React. The usual answer is an inline `<script>` in `index.html`; the web container's CSP (`script-src 'self'`, `apps/web/Caddyfile`) refuses it, and allowing it would need `'unsafe-inline'` (which also lets an injected script run) or a hash of the script kept in step with every edit. Instead `index.html` loads `public/theme.js` with a plain `<script src>` in `<head>`: no `type="module"`, no `defer`, so it runs before `<body>` is read. It costs one small request, revalidated on each visit like `index.html`. `<meta name="color-scheme" content="light dark">` makes the browser paint the device's scheme even before the CSS arrives. The CSP is unchanged.
- **Tailwind, Radix and the CSP: no `'unsafe-inline'` needed for styles either.** Tailwind writes one static file (`style-src 'self'`). Radix positions the menu through React's `style` prop, which sets properties through the CSSOM (`element.style.top = …`); CSP governs `<style>` elements and `style` attributes in markup, not the CSSOM. The one thing that would break is a modal menu: its scroll lock (`react-remove-scroll`) inserts a `<style>` element, which the CSP blocks with a violation, so `DropdownMenu` defaults to `modal={false}` (it still closes on Escape, an outside click and focus leaving). The e2e suite fails on any CSP violation.

## The cart store (artikel 09)

- **What moved, what stayed.** The guest cart's token moved from Bab 9's `CartTokenProvider` (React state plus a ref for late readers) into a Zustand store, `features/cart/cart-store.ts`. The cart itself (lines, subtotal, count) stays in TanStack Query's cache under `["cart", token]`: server data has one home.
- **The store's shape:**

  | Field | Kind | Meaning |
  |---|---|---|
  | `token` | `string \| null` | the `X-Cart-Token` of the guest cart; `null` before the first add |
  | `cartExpired` | `boolean` | the API answered `CART_NOT_FOUND` and the token was forgotten; the cart page says so until the buyer closes the message or a new cart is created |
  | `setToken(token)` | action | keeps the token of a cart the API just created (and clears `cartExpired`) |
  | `forgetCart()` | action | forgets the token; sets `cartExpired` only when there was a token to forget |
  | `dismissCartExpired()` | action | the buyer closed the message |

  Components read one field at a time with a selector (`useCartStore(selectCartToken)`), so the header's count does not render again when `cartExpired` changes. Code that runs after its render (a queued mutation) reads `getCartToken()`, which is `useCartStore.getState().token`: the role Bab 9's ref played, without a provider.
- **Bab 9's add-to-cart semantics are unchanged.** Every add still runs in one queue (`scope: { id: "cart" }`); `mutationFn` reads the token when its turn comes, so a second add uses the cart the first one created; `onMutate` guesses at the click; the last add of a burst refetches the cart when it settles; `CART_NOT_FOUND` from an add or from `GET /v1/cart` forgets the token (`forgetCart`), and the next add starts a new guest cart.
- **Why a store and not context here:** the token is read by distant components (header, product page, cart page) and by code outside any render (the mutation queue), and artikel 10 persists it; a store does all three without a provider.
- **For the tests:** the store is a module-level singleton, so its state outlives one test. Reset it between tests with `useCartStore.setState({ token: null, cartExpired: false })`. Until the Bab 9 tests move to the store, `cart-token-context.ts` and `CartTokenProvider.tsx` stay as a bridge that only tests import (each says so); they go when the tests have moved.

## Keeping the cart across reloads (artikel 10)

- **What is saved:** the token only, under the `localStorage` key `goshop:cart`, as `{"state":{"token":"…"},"version":1}` (Zustand's `persist` middleware; `partialize` picks the token, so the "cart expired" message and the actions are never saved). A reload, a new tab or a browser restart finds the same guest cart. This fixes Bab 9's limitation, where a reload forgot the token and showed an empty cart while the old one sat unreachable on the server.
- **The version** lives inside the value (`CART_STORAGE_VERSION`). A value saved under another version goes through `migrate`, which today starts without a cart: there is no older shape to convert. Without a `migrate`, Zustand would log an error and ignore the value.
- **Storage can fail; the page must not.** `safeLocalStorage` wraps `getItem`, `setItem` and `removeItem` in `try`/`catch`: reading `window.localStorage` throws when storage is blocked, `setItem` throws when the quota is full. A failure means the cart is not remembered, nothing worse. Unparseable JSON is caught by `persist` itself, and the store starts empty.
- **What is read is untrusted.** `merge` keeps the stored token only when it is a non-empty string (`storedToken`); anything else means no cart. A string that is not a real token is answered `CART_NOT_FOUND` like a stale one.
- **A stale token is forgotten on the first request.** `localStorage` answers synchronously, so the token is in the store before the first render, and the header's count asks `GET /v1/cart` for that cart at once. When the API no longer knows it (the cart was cleaned up, or merged after a login), the query calls `forgetCart`, shows an empty cart, and the cart page says "Keranjang Anda sebelumnya sudah tidak berlaku, jadi sekarang kosong." until the buyer closes it or adds again.
- **Tabs agree.** A tab that creates or forgets a cart writes `localStorage`; the browser sends every other tab of the origin a `storage` event, and `syncCartAcrossTabs` rehydrates the store there, so two tabs never start two guest carts.
- **Why `localStorage` is fine for this token and never for an auth token** (ADR 0005): any script running in the page can read `localStorage`. A stolen access or refresh token is the account: orders, addresses, everything. A stolen guest cart token is an anonymous list of products, with no personal data; it cannot check out (checkout needs a login) and it stops working once merged. The CSP (`script-src 'self'`) is what keeps foreign scripts out in the first place. Auth tokens stay in memory and, from artikel 12, in an `HttpOnly` cookie no script can read.
- **For the tests:** the store is created once per module and reads `localStorage` at that moment. Clear `goshop:cart` and reset the store (`useCartStore.setState({ token: null, cartExpired: false })`) between tests; to test hydration, write the key first and call `useCartStore.persist.rehydrate()`.

## The logged-in user in context (artikel 11)

- **Context, not a store, for the session.** It changes rarely (a login, a logout, a token refresh shortly before each access token expires, 15 minutes by default), so the render a context change causes in each reader does not matter. A provider is a scope: a test wraps a component in a provider with the session it needs, and nothing carries over to the next test, which a module-level store would. And from artikel 12 the provider owns the session's lifecycle (restore at start-up, refresh before expiry), which is component work: effects that start and clean up with the app.
- **What `useSession()` returns:** `{ status: "anonymous", session: null }` or `{ status: "authenticated", session }`, plus `setSession` and `getAccessToken`. Checking `status` narrows `session` (a discriminated union, as Bab 7's `AsyncState`), so `AccountNav` never handles a `null` it has already ruled out. Artikel 12 adds a third status, `"restoring"`, for the start-up refresh.
- **One value object per session.** `SessionProvider` memoises the value on `session`, and its functions are created once (`useCallback`), so readers render again only when the session changes: a login, a logout, and, from artikel 14, each token refresh, which publishes a new `Session` with the new access token.
- **`getAccessToken()`** reads the session manager's current value (a variable inside `createSessionManager`, `features/auth/session-manager.ts`, replaced at once by `setSession`, a login, a refresh or a logout; there is no React ref and no state behind it), for code that runs outside a render: a request sent by a mutation or a query function (artikel 13). The same pattern as the cart's `getCartToken`, for the same reason.
- **Still in memory only.** A reload logs the buyer out until artikel 12 keeps the refresh token in an `HttpOnly` cookie and restores the session from it. The access token never goes to `localStorage` (ADR 0005), and `useLogin` still drops the refresh token from the JSON answer.

## The web session (artikel 12–14)

The API side is [ADR 0008](../adr/0008-web-session-cookie.md) (the storefront's request, with the four places the API differs, is `bab-10-auth-cookie-contract.md`). This is the storefront side.

### Where each token lives (artikel 12)

| Token | Where | Who can read it | Lifetime |
|---|---|---|---|
| Refresh token | the `goshop_refresh` cookie: `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/web`, on the API's host | nobody's JavaScript; the browser sends it to `/v1/auth/web/*` only | 30 days, rotated on every refresh |
| Access token | a variable inside the session manager (`features/auth/session-manager.ts`), in this tab's memory | the storefront's code while the tab is open | 15 minutes; gone on reload |
| Guest cart token | `localStorage` (`goshop:cart`, artikel 10) | any script on the page; harmless (artikel 10) | until merged or cleaned up |

No token is ever written to `localStorage` or `sessionStorage`: any script that runs on the page (an XSS, a compromised dependency) can read them. With the refresh token in an `HttpOnly` cookie, such a script can still act as the buyer while the page is open, but it cannot take the session away with it. The access token in memory is the price: a reload loses it, so the storefront asks for a new one at start-up.

### The calls, and where they live

- **`webLogin`, `webRefresh`, `webLogout` are in `packages/shared/src/api/auth.ts`**, next to `login` and `register`, typed from `api/openapi.yaml` (`WebSession`). They are endpoint functions like every other, and the admin dashboard (also a browser app) will need the same session. They are the only calls that send `credentials: "include"` (new `credentials` option of the client) and `X-GoShop-Client: web` (`WEB_CLIENT_HEADERS`); every other request keeps fetch's default and never carries a cookie. Their timeout is 20 s, longer than the API's 15 s, so the client never gives up on a refresh the server may still complete (it would keep the old cookie while the server had rotated it: a reuse on the next refresh).
- **`mergeCart`** (`POST /v1/cart/merge`) joined `getCart` and `addCartItem` in `packages/shared/src/api/cart.ts`.
- **The protocol is plain TypeScript** (`features/auth/session-manager.ts`): who is logged in, `restore`, `login`, `logout`, `refresh`. `SessionProvider` creates one manager and turns its changes into React state, so the rules can be read (and tested) without React.

### Start-up: the silent refresh

`SessionProvider` starts in a third status, **`"restoring"`**, and calls `restore()` once: `POST /v1/auth/web/refresh`. The browser adds the cookie if it has one.

| Answer | Meaning | Status |
|---|---|---|
| `200` + `WebSession` | the cookie was good; it is rotated, the access token is new | `authenticated` (after the guest cart merge, below) |
| `204` | no cookie: a visitor who never logged in, or logged out | `anonymous` |
| `401` | the cookie was refused (expired, revoked, reused); the API has cleared it | `anonymous` |
| network error, `429`, `500` | unknown; the cookie may still be good | `anonymous` for now; the next reload tries again |

Tests and stories can skip the restore with `<SessionProvider initialSession={null}>` (a guest, no request) or `initialSession={session}`; the app never passes it.

While restoring, the header shows neither "Masuk" nor a name (`AccountNav` renders nothing), the cart is not fetched (`useCart` waits: nobody knows yet whose cart it is), and an add to the cart waits for the answer (`ready()` in `useAddToCart`). StrictMode runs the effect twice in development; `restore()` returns the same promise the second time, so the cookie is sent once.

### Several tabs: one refresh at a time (Web Locks)

The API rotates the refresh token on every refresh and has no grace window: a token used a second time is treated as stolen, and the **whole session (the token family) is revoked**, including the access tokens already handed out (Bab 4's reuse detection, a Redis marker per session). Every tab of the storefront shares the one cookie. Reload two tabs at the same moment and, without coordination:

1. tab A sends `goshop_refresh=R1`; the API rotates it to R2 and answers A;
2. tab B had also sent R1, before A's answer arrived; the API sees R1 a second time: reuse. The family is revoked;
3. B gets `401`, A's new token R2 is revoked too, and both tabs are logged out.

`withSessionLock` (`features/auth/refresh-lock.ts`) wraps every call that touches the cookie (login, refresh, logout) in `navigator.locks.request("goshop:session", task)`. The Web Locks API grants a named lock to one holder at a time across every tab of the origin, in order, and releases it when the task's promise settles (or the tab closes). Tab B's request is only *started* after A's task has finished, and A's task finishes only after A's whole answer has arrived, by which time the browser has stored R2 from its `Set-Cookie`. So B sends R2, gets R3, and both tabs stay logged in. Each tab still holds its own access token (memory is per tab); both are valid, because they belong to the same, unrevoked session.

Inside one tab, a refresh already on its way is shared (`refresh()` keeps the promise), so two callers never queue two refreshes.

**Fallback.** `navigator.locks` exists only in a secure context (https, or `http://localhost`). On a plain-http LAN address it is missing; `withSessionLock` then queues the tasks of its own tab in a promise chain. Two tabs can then race exactly as above, and the result is a logout, never a security problem. The API was asked for no grace window for this reason (ADR 0008).

### Login, logout and the guest cart

- **Login** (`useLogin` → `useSession().login`): `webLogin` inside the lock; the answer's access token stays in the manager. The mutation returns nothing, so no token lands in TanStack Query's MutationCache (and `gcTime: 0` still drops the password from it).
- **The guest cart is merged at login, in artikel 12** (Bab 9 deferred it to Bab 10). After the login or a restore and *before* the session is published, `onStart` (wired in `app/App.tsx` to `features/cart/merge-guest-cart.ts`) calls `POST /v1/cart/merge` with the guest token, through a client that already carries the new access token. The answer is the user's cart, written straight into the cache under `["cart", "user", userId]`, and the guest token is cleared (quietly: nothing was lost, so no "cart expired" message), and every tab follows through the `storage` event. `CART_NOT_FOUND` also clears it. Any other failure keeps the token and lets the login succeed: the next login or reload merges it. The header switches to the user's cart once, already merged. The auth feature does not import the cart; `App.tsx` wires the two.
- **From then on the cart is the user's.** `useCart` and `useAddToCart` use `useSession().authApi` (adds `Authorization`) and the key `["cart", "user", userId]`; a guest keeps `["cart", token]` and `X-Cart-Token`. The API picks the cart by the access token.
- **Logout** (`AccountNav` → `useSession().logout`): `webLogout` inside the lock, which revokes the session on the server and clears the cookie; only then is the session forgotten here and `onEnd` drops every user cart from the cache (`forgetUserCarts`). If the API cannot confirm (network, `500`, which keeps the cookie), the buyer stays logged in and the header says "Gagal keluar…" (`role="alert"`): looking logged out while a reload would bring the session back would be worse. The focus still moves to "Masuk" after a logout that worked.
- **Known limit:** a tab that was already open does not learn about a login or logout in another tab until it next talks to the API (or reloads). The guest token does follow (it is in `localStorage`).

### Protected routes and the way back (artikel 13)

- **`/akun`** (`features/account/`, lazy like the product page) shows the account from `GET /v1/me` (`getMe` in `packages/shared/src/api/me.ts`), fetched with `authApi` under the key `["me", userId]`. It is fetched rather than taken from the login answer: a profile can change while the session lives, and the page should show the server's word. The header's menu has "Akun saya", a real link inside the menu (`DropdownMenuItem asChild`).
- **`RequireAuth`** (`features/auth/components/RequireAuth.tsx`) is a layout route without a path around every page that needs a login, the same shape as `AuthLayout`. While the session is `"restoring"` it shows "Memeriksa sesi Anda…" and decides nothing: deciding then would send a logged-in buyer who reloads `/akun` to the login form. `"anonymous"` renders `<Navigate to="/masuk?kembali=…" replace />` with the full path, query and hash asked for; `replace`, so Back from the login form does not land on `/akun` and redirect again. `"authenticated"` renders the page.
- **It is not the security.** The API refuses every protected request without a valid token. The redirect only spares the buyer a page of 401s; never put anything in the bundle that a guest must not see.
- **The way back: `?kembali=`**, read by `LoginPage`, which renders `<Navigate to={returnTo} replace />` as soon as the session is there (after a login, or when a logged-in buyer opens `/masuk`). A query parameter rather than router state: it survives a reload of the login page and is visible in the address bar.
- **No open redirect** (`features/auth/return-to.ts`, `safeReturnPath`). Anyone can send a buyer a link to `/masuk?kembali=…`; followed blindly, a real login on the real shop would end on `https://evil.example/masuk`, dressed as the shop, asking for the password "again". Only a path on our own origin passes, checked in this order:
  1. **The input** must start with exactly one `/` (`//evil.example` and `/\evil.example` are other hosts to a browser). This is a fast path, not the guard.
  2. **The parsed URL** (`new URL(value, location.origin)`, the parser the browser itself uses, which drops tabs and newlines and turns `\` into `/`) must still have our origin.
  3. **The parsed path** must still start with exactly one `/`. Parsing normalises the path: it removes dot segments (`/./`, `/x/../`, and the encoded `%2e`) and turns `\` into `/`, so `/.//evil.example` becomes a URL on our origin whose path is `//evil.example`. It passes step 2, and as a string it is a protocol-relative link to another host again. Only a check on the output sees that; a check on the input cannot.
  4. **Only the parsed `pathname + search + hash`** is used, never the original string, so what is navigated to is exactly what steps 2 and 3 checked.

  `/masuk` and `/daftar` become `/` (a loop), and so does anything over 2 048 characters. Checked in the browser:

  | `kembali` | Goes to |
  |---|---|
  | `/akun`, `/produk/kaos?x=1#a` | itself |
  | `//evil.example/x`, `/\evil.example`, `/<tab>/evil.example`, `https://evil.example`, `javascript:alert(1)`, `akun`, empty | `/` |
  | `/.//evil.example`, `/x/..//evil.example/masuk`, `/%2e//evil.example`, `/./\evil.example` (each normalises to the path `//evil.example…`) | `/` |
  | `/masuk?kembali=/akun` | `/` |
  | `/%2F%2Fevil.example` | itself: an encoded slash is part of a path on our site (the 404 page), not a host |

- **The guest cart merge is in artikel 12**, at login, not here; a protected page only needs the session.
- **Logout on a protected page** ends on `/masuk?kembali=/akun`, like any visit there without a session; logging in again goes back. The cached account is dropped on logout with the user's cart (`onSessionEnd` in `app/App.tsx`).

### The refresh-token interceptor (artikel 14)

Every request made as the logged-in user goes through `useSession().authApi`, built by `createAuthClient` (`features/auth/auth-client.ts`) around the plain client. It has the same shape as `api`, so every endpoint function of `@goshop/shared` takes it unchanged; a guest's request goes out without a token.

1. **Proactive refresh, on demand.** The session manager keeps, beside the access token, the moment to replace it: `expires_in` from the answer (relative seconds, so a wrong client clock does not matter) minus a margin of 30 s, or half the lifetime when that is shorter (`refreshMarginMs`; the API allows `APP_ACCESS_TOKEN_TTL` down to `1m`). Before each request, `ensureFreshToken()` refreshes first when that moment has passed.
   - **Why at all:** the normal case then never sees a `401`, so no failed request, no second round trip, and no red "Failed to load resource" line in the console (which the e2e suite counts as a failure).
   - **Why on demand, not a timer:** a timer would refresh every tab every 14 minutes even when nobody uses it, spending the API's refresh limit (60 per 15 minutes per IP, shared by everyone behind one NAT) and rotating the cookie for nothing; and browsers throttle timers in background tabs, so it would fire late exactly when it matters. On demand, an idle tab costs nothing, and the first request after a pause pays one refresh.
2. **Reactive refresh, once.** If the API still answers `401 UNAUTHORIZED` (a tab that slept past the expiry, a clock jump, the API restarted with another signing key, the session revoked elsewhere), the client calls `refreshAfterUnauthorized(staleToken)` and sends the same request again, **once**; a second `401` is thrown. The API answers an expired *access* token with `UNAUTHORIZED`, never `TOKEN_EXPIRED` (sdk `JWTAuth` does not tell expired from invalid; `TOKEN_EXPIRED` is only about the refresh token), so any `401` to a request that carried a token counts. Retrying a `POST` is safe: the `401` comes from the auth middleware, before the handler runs.
3. **One refresh for many requests.** `refresh()` keeps a refresh on its way as one promise: every request that needs a token while it runs waits for the same answer. A request whose `401` arrives after another request already refreshed sees that the current token is no longer the one it sent, and retries with the new one without refreshing again. Across tabs, the Web Lock (artikel 12) still applies.
4. **When the refresh fails.** `204` or a `401` from the refresh endpoint means the session is over: the manager publishes "anonymous" and runs `onEnd` (the user's cart and account leave the cache; the guest token was already cleared by the merge), the caller gets a `401 UNAUTHORIZED`, and `RequireAuth` sends a protected page to `/masuk?kembali=…`. After the reactive refresh (2) that is the original `401`. After the proactive one (1) the request has not been sent yet, and it is **not sent at all**: `ensureFreshToken` rejects with the same `401 UNAUTHORIZED` the API would have given. Sending it without a token would make it a guest's request, which its caller never asked for: a logged-in add to the cart would land in a new guest cart that no token points to, and its answer would be written under a user key `onEnd` had just removed. `useAddToCart` therefore fails visibly ("Sesi Anda sudah berakhir…"), writes nothing back under `["cart", "user", id]` once that user's session is gone (neither the rollback, nor a late answer, nor the reset of the guess), and, as a guard, refuses a logged-in add whose answer carries a `cart_token`. Only a visitor sends requests as a guest; that includes a second add the buyer clicked while logged in that was still waiting in the cart queue when the first one ended the session: by its turn the buyer is a visitor, so it goes as a guest's add and its new guest token is kept. A network error, `429` or `500` from the refresh keeps the session (the cookie may still be good): the request fails with that error and can be retried.

Checked against the API with `APP_ACCESS_TOKEN_TTL=1m`:

| Case | Requests seen |
|---|---|
| 36 s after login, add to cart + refetch account and cart together | one `POST /v1/auth/web/refresh 200`, then `POST /v1/cart/items`, `GET /v1/me`, `GET /v1/cart`, all `200`; no `401`, no console error |
| the API restarted with another `JWT_SECRET` 20 s after login (the client still thinks its token is fresh), two requests together | `GET /v1/me 401` and `GET /v1/cart 401`, one `POST /v1/auth/web/refresh 200`, both retried once with the new token: `200` |
| the session revoked from elsewhere (`/web/logout` with the same cookie) | `GET /v1/cart 401`, `GET /v1/me 401`, `POST /v1/auth/web/refresh 401`; the page goes to `/masuk?kembali=%2Fakun`, the header shows "Masuk", no user query left in the cache, the cookie cleared |

## Accessibility (artikel 07)

Bab 8 and 9 already label every field, link errors with `aria-describedby`, move the focus after a navigation and render live regions before they speak (the Bab 9 notes above). Artikel 07 checks the new look against the same standard (WCAG 2.2, level AA) and fixes what the restyle missed:

- **A skip link.** "Langsung ke konten utama" is the first stop for Tab on every page (`app/SkipLink.tsx`). It sits above the screen and slides in when focused (`-translate-y-24 focus:translate-y-0`; the slide only when the viewer allows motion). Its click focuses `<main id="konten">` itself instead of following `#konten`, which would add a history entry and look like a navigation to the router.
- **A field's edge you can see.** WCAG 1.4.11 asks 3:1 for what identifies a control. The fields and outline buttons used `--border` (1.4:1 against a card): the box was nearly invisible. `--input` is now `#768390` in both themes (measured from the tokens: 3.64:1 on the page to 3.87:1 on a card in light, 4.47:1 on a card to 4.88:1 on the page in dark); decorative lines keep `--border`.
- **The focus is always visible.** One rule in `@layer base` gives every `:focus-visible` element a 3 px `outline` in `--ring` (6.7:1 light, 5.6:1 dark against a card), never removed. The menu's highlighted item has the focus but showed it only as the `accent` background, 1.1:1 against the menu: it now gets the ring's outline inside its edge too. `outline-hidden`, not `outline-none`, where a control draws its own state: forced-colours mode still shows it.
- **Keyboard through the menus.** The account menu is Radix's: Enter, Space or the down arrow open it from its button, the arrow keys, Home and End move, Escape closes and gives the focus back to the button. "Keluar" removes that button with the session, so `AccountNav` gives the focus to the "Masuk" link that replaces it instead of letting it fall to `<body>`. The category list's toggle on a phone says whether the list is open (`aria-expanded`, `aria-controls`), and a folded list is `hidden`, out of the Tab order.
- **A toggle that says its state.** The theme button keeps one name, "Mode gelap", and says on or off with `aria-pressed`; the filled moon shows the same state without relying on colour.
- **What to check by hand**, since no automated tool sees all of it: Tab from the top of each page (the skip link first, then the header, then the content) and watch the ring at every stop; each page at 320 px wide and at 200% zoom; both themes; forced colours (Chromium's DevTools, Rendering, "Emulate CSS media feature forced-colors").

## When you need global state, and when you do not (artikel 08)

"Global state" is state that any component can read without it being passed down. It is the easiest kind to reach for and the hardest to reason about: any component may change it, and anything that reads it renders again when it does. So the question is not which library, but whether the state should be global at all. Four questions, in order; the first "yes" decides:

| Question | If yes, it lives in | GoShop examples |
|---|---|---|
| Is it a copy of the server's data? | **TanStack Query** (server state): it already fetches, caches, shares between components, refetches when stale and forgets what nobody uses | the catalog, a product, the categories, the cart's lines and subtotal |
| Should a link, a bookmark or a reload bring it back? | **The URL** (path and query string) | the product on screen, the category filter, the search text, the sort order |
| Does one component, or one parent and its children, need it? | **`useState`** in the closest common parent, passed down as props | the quantity on the product page, the chosen variant, whether the category list is open on a phone |
| Do distant parts of the page need it, and is it nobody's copy of server data? | **Global client state**: React context or a store | the guest cart's token (the header's count, the product page's add button and the cart page all need it), the logged-in user, the theme |

Most of the storefront's state stops at one of the first three questions. Putting the cart's *lines* in a global store would be the classic mistake: it would duplicate TanStack Query's cache, and the two copies would disagree after the next refetch. The store keeps only what the server does not hold for us: which cart is ours.

Two tools for the fourth row, and GoShop uses both:

- **React context** passes a value down a subtree: no dependency, and a test or a page can wrap a part of the tree in a different provider. Every component that reads the context renders again when its value changes, so it suits values that change rarely (the logged-in user, artikel 11) and needs care (a memoised value, split contexts) for anything else.
- **A store (Zustand, artikel 09)** lives outside React. A component subscribes to a slice with a selector and renders again only when that slice changes; code outside a component (a mutation running later, a storage event) reads and writes it without a hook; and a middleware persists it (artikel 10). It suits state that changes often or must be read outside a render.

The theme (artikel 05) is global by nature but is neither: it lives on `<html>` (the CSS reads it there) and in `localStorage`, and the one component that changes it keeps a mirror in `useState`.

## Prototyping UI with AI, then tidying it by hand (artikel 06)

The storefront code of this course is written with an AI coding agent (Claude Code; the commits say so) and then reviewed against the rules in `docs/ai-rules.md`. AI is good at a first layout: it knows Tailwind's and shadcn/ui's vocabulary and produces something that looks right in seconds. What it does not know is *this* project: its tokens, its tests, its CSP, its heading structure. Review is where those come in.

### The AI box: the empty cart

`features/cart/components/EmptyCart.tsx`, what `/keranjang` shows when the cart is empty, started as an AI draft.

**Prompt** (given to a separate model session, with no access to the repository):

> You are helping prototype UI for GoShop, an Indonesian online shop storefront built with React 19, TypeScript, Tailwind CSS v4 and shadcn/ui (`Button` with variants default/outline/ghost/link, sizes default/sm/icon, and `asChild`, imported from "@/components/ui/Button.tsx"); routing is react-router v7 (`Link` from "react-router"); icons come from lucide-react. Colour utilities are semantic tokens: bg-card, bg-muted, text-muted-foreground, text-primary, border-border.
>
> Write a component `EmptyCart` for the cart page when the cart has no items: Indonesian copy ("Keranjang Anda masih kosong."), an icon, a short hint, and a call to action that goes to the catalog at "/". Mobile first. Reply with one .tsx file only.

**Raw output** (unedited):

```tsx
import { Link } from "react-router";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";

export function EmptyCart() {
  return (
    <section
      aria-labelledby="empty-cart-title"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card px-6 py-12 text-center sm:py-16"
    >
      <div className="flex size-20 items-center justify-center rounded-full bg-muted">
        <ShoppingCart
          aria-hidden="true"
          className="size-10 text-muted-foreground"
        />
      </div>

      <h2
        id="empty-cart-title"
        className="text-lg font-semibold text-primary sm:text-xl"
      >
        Keranjang Anda masih kosong.
      </h2>

      <p className="text-sm text-muted-foreground sm:text-base">
        Yuk, jelajahi katalog dan tambahkan produk favorit Anda ke keranjang.
      </p>

      <Button asChild className="mt-2 w-full sm:w-auto">
        <Link to="/">Mulai Belanja</Link>
      </Button>
    </section>
  );
}

export default EmptyCart;
```

**Manual changes and why:**

| Change | Why |
|---|---|
| `<section aria-labelledby>` with an `<h2>` → a `<div>` with a paragraph | The page is already one region with its `<h1>` "Keranjang"; a landmark for a message adds a stop to every screen-reader landmark list, and "Keranjang Anda masih kosong." is a sentence, not the title of a part of the page |
| Hard-coded `id="empty-cart-title"` removed | An id written by hand collides as soon as the component renders twice; GoShop uses `useId` when it needs one (`Section`, `TextField`). Here, with no heading, none is needed |
| `rounded-xl border border-border bg-card` removed | `CartPage` is already a `Card`: the draft drew a card inside a card. The model could not know; it never saw `CartPage` |
| `rounded-xl` | Outside GoShop's radius scale (`rounded-sm`/`-md`/`-lg`, derived from `--radius`); dropped with the border |
| `text-primary` on the heading → plain `font-semibold` | Primary is the colour of links and main actions. Text in it looks clickable |
| "Mulai Belanja" → "Lihat katalog" | The link the page had since Bab 9; the unit tests find it by that name. Also the storefront writes buttons and links in sentence case ("Tambah ke keranjang") |
| `export default` removed | The project exports by name only, so an import always says what it takes |
| Sizes and the hint's wording shortened | Matter of taste: a smaller icon (`size-16`) under the page's `<h1>`, and the hint without "Yuk," to match the storefront's tone |
| Kept | The layout (centred column, full-width button on a phone), `aria-hidden` on the icon, `Button asChild` around `Link` (a link that looks like a button is still a link) |

The model got the vocabulary right and the context wrong, which is the usual pattern. Every change above came from something outside the prompt: the page around the component, the tests, the token scale, the house style.

### What review changed elsewhere in this chapter

Each of these was in code drafted by the agent that looked fine at first sight:

- **Contrast** (artikel 04, found by measuring every pair): white text on the dark theme's blue and red buttons, 3.1:1 and 2.5:1. Fixed with a `*-foreground` token per theme.
- **A raw value past the tokens** (artikel 02 → 04): `border-[var(--border)]` on the cart lines; an arbitrary value that bypassed the theme. Now `border-border`.
- **The CSP** (artikel 03): shadcn/ui's menu is modal by default, and its scroll lock injects a `<style>` element that the storefront's CSP blocks and reports as a violation, which the e2e suite treats as a failure. Fixed with `modal={false}`.
- **Forced colours** (artikel 03): shadcn/ui's focus ring is a `box-shadow`, which Windows' forced-colours (high-contrast) mode removes. Replaced with an outline.

### How to prompt for UI, and what to check

- Give the model the vocabulary it cannot guess: the token names, the component imports, the routing library, the language of the copy. It still will not know the page around the component; check that yourself.
- Ask for one component, not a page. Small drafts are cheap to review line by line.
- Check every draft for: raw colours or sizes instead of tokens; text in a colour that means something else; landmarks and headings that do not fit the page; hard-coded ids; labels on every control; a visible focus state; the copy's language and case; anything that would need `'unsafe-inline'` (inline `<script>`, `<style>` elements, `style="…"` in HTML).
- Run it: the unit tests, the e2e suite (which fails on CSP violations and on console errors), the browser at a phone width and in both themes.

## Where each Bab 10 article's ideas live

Paths are relative to `apps/web/src` unless they start with another top-level folder.

| Article | Concept | Where to read it |
|---|---|---|
| 01 | Tailwind CSS v4 | `vite.config.ts` (`@tailwindcss/vite`), `@import "tailwindcss"` in `index.css`, the utilities in `app/RootLayout.tsx` and `app/SiteHeader.tsx` (breakpoint, state and arbitrary variants) |
| 02 | Responsive, mobile first | `features/catalog/components/CatalogPage.tsx` (the sidebar from `md`), `ProductGrid.tsx` (2/3/4 columns), `CategorySection.tsx` (the list folds behind a button below `md`, `aria-expanded`), `CatalogToolbar.tsx`, `features/product/components/ProductDetail.tsx`, `features/cart/components/CartPage.tsx` |
| 03 | shadcn/ui | `components/ui/` (`Button.tsx` with `cva` variants and `asChild`, `Input.tsx`, `Label.tsx`, `NativeSelect.tsx`, `Badge.tsx`, `DropdownMenu.tsx`), `lib/utils.ts` (`cn`), `features/auth/components/AccountMenu.tsx` (lazy) |
| 04 | Design tokens | `index.css` (colour roles on `:root`, `@theme inline`, `@theme` for type, spacing, radius, page width and animation, `@layer base`); the contrast table above |
| 05 | Dark mode | the `dark` custom variant and `@variant dark` in `index.css`, `public/theme.js`, `index.html`, `features/theme/` (`theme.ts`, `useTheme.ts`, `components/ThemeToggle.tsx`), the toggle in `app/SiteHeader.tsx` |
| 06 | Prototyping UI with AI | the section above; `features/cart/components/EmptyCart.tsx` |
| 07 | Accessibility | `app/SkipLink.tsx` and `id="konten"` on `<main>` in `app/RootLayout.tsx`; `--input` in `index.css` (a field's edge at 3:1); the highlighted item's outline in `components/ui/DropdownMenu.tsx`; the focus that moves to "Masuk" after "Keluar" in `features/auth/components/AccountNav.tsx`; `aria-pressed` in `ThemeToggle.tsx`; the Bab 9 notes below still hold |
| 08 | When global state, and when not | the section above; the note above `App` in `app/App.tsx` |
| 09 | Zustand: the cart store | `features/cart/cart-store.ts` (`create`, actions, selectors, `getState` in `getCartToken`), read in `hooks/useCart.ts`, `hooks/useAddToCart.ts` and `components/CartPage.tsx` (the "cart expired" notice); `CartTokenProvider` is gone from `app/App.tsx` |
| 10 | Persisting the cart | `persist` in `features/cart/cart-store.ts` (`CART_STORAGE_KEY`, `CART_STORAGE_VERSION`, `safeLocalStorage`, `partialize`, `migrate`, `merge` with `storedToken`), `syncCartAcrossTabs` called from `main.tsx`; the stale-token path in `features/cart/api/queries.ts` |
| 11 | Context for the logged-in user | `features/auth/session-context.ts` (`SessionValue` as a discriminated union on `status`, `useSession`, why context and not a store), `features/auth/SessionProvider.tsx` (a memoised value, stable functions, `getAccessToken` handed through from the session manager, which holds the current token), `features/auth/components/AccountNav.tsx` (narrowing on `status`) |
| 12 | Access and refresh tokens, safely: httpOnly cookie vs memory | `webLogin`/`webRefresh`/`webLogout` and the `credentials` option in `packages/shared` (`api/auth.ts`, `api/client.ts`); `features/auth/session-manager.ts` (restore, login, logout, single-flight refresh), `refresh-lock.ts` (Web Locks), `SessionProvider.tsx` (`"restoring"`), `hooks/useLogin.ts`, `components/AccountNav.tsx` (logout); the guest cart merge in `features/cart/merge-guest-cart.ts`, wired in `app/App.tsx`; the user's cart in `features/cart/api/queries.ts`, `hooks/useCart.ts`, `hooks/useAddToCart.ts`; the API's side: ADR 0008 and `docs/web/bab-10-auth-cookie-contract.md` |
| 13 | Protected routes and the redirect to login | `features/auth/components/RequireAuth.tsx` (wait while restoring, `<Navigate replace>`), `features/auth/return-to.ts` (`safeReturnPath`, `loginPathFor`), `features/auth/components/LoginPage.tsx` (`?kembali=`, `<Navigate>` once logged in), `features/account/` (`/akun`, `GET /v1/me` via `getMe` in `packages/shared/src/api/me.ts`), the `RequireAuth` layout route in `app/routes.tsx`, "Akun saya" in `AccountMenu.tsx` |
| 14 | Automatic refresh-token interceptor | `features/auth/auth-client.ts` (`createAuthClient`: fresh token before, one refresh and one retry after a `401`), `features/auth/session-manager.ts` (`refreshMarginMs`, `ensureFreshToken`, `refreshAfterUnauthorized`, the single-flight `refresh`, ending the session), `authApi` in `SessionProvider.tsx`, the cleanup in `onSessionEnd` (`app/App.tsx`) |
| 15 | Recap and challenge | the two sections below; no code |

## Bab 10 recap (artikel 15)

- **Look:** Tailwind CSS v4 utilities on top of a handful of design tokens (colour roles, type, spacing, radius, page width), shadcn/ui components copied into `components/ui` and changed for GoShop, mobile-first layouts, dark mode that follows the device or the viewer's choice without an inline script, and contrast measured for every pair (artikel 01–05, 07).
- **AI as a draft, not an author:** the empty cart was prototyped with a model and every change review made to it is written down (artikel 06).
- **State, in its right place:** server data in TanStack Query, page state in the URL or a component, and only two truly global things: the guest cart token in a persisted Zustand store, the session in context (artikel 08–11).
- **The session:** the refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie no script can read, the access token in memory only, a silent refresh at start-up so a reload keeps the buyer logged in, every cookie call serialised across tabs with the Web Locks API so reuse detection never fires on an honest buyer, the guest cart merged into the user's at login, protected pages that wait for the session and return after login without an open redirect, and an interceptor that refreshes before expiry and once after a `401` (artikel 12–14).

Bab 10's state is still a Vite single-page app: everything renders in the browser. The CSP is unchanged by the session work: cookies are not a CSP matter, and the only origin the app calls is still the API's (`connect-src`).

## Challenge: a mini cart drawer

Clicking "Keranjang" in the header goes to `/keranjang`, a whole page. Most shops open a small panel at the side instead: the lines, the subtotal, and a link to the full cart, without leaving the product the buyer was looking at. Build it. There is no solution in the code; the steps say which article each part leans on.

1. **A button, not a link, in the header** (artikel 03 and 07). `CartNavLink` stays a link for anyone who opens it in a new tab; add a button beside it (or turn the count into one) with `aria-haspopup="dialog"` and `aria-expanded`, that opens the drawer.
2. **The drawer is a dialog** (artikel 03). shadcn/ui's `Sheet` is Radix's `Dialog`, which is modal: it traps the focus, closes on Escape, and returns the focus to the button that opened it. Copy it into `components/ui/Sheet.tsx`. Then run the e2e suite: a modal Radix component locks the page's scroll with `react-remove-scroll`, which inserts a `<style>` element, and the storefront's CSP (`style-src 'self'`) blocks it with a violation, exactly as with the menu. Find a way that keeps the CSP as it is (the menu chose `modal={false}`; is that right for a dialog that must trap the focus? what else locks the scroll without a `<style>` element?). Do not add `'unsafe-inline'`.
3. **Where its open state lives** (artikel 08). If only the header opens it, `useState` in the header is enough. If "Tambah ke keranjang" should also open it after an add, two distant components need it: decide between lifting it, a context, or a small Zustand store, and write down why with the four questions in `app/App.tsx`. Whatever you choose, nothing about it is persisted: a reload should not reopen a drawer.
4. **The data is already there** (artikel 09–12). `useCart()` gives the guest's or the logged-in user's cart, whichever applies, from the same cache entry the header's count uses: opening the drawer costs no request when the cache is fresh. Show each line's name, variant, quantity and total, the subtotal with `formatRupiah`, the `problem` badges `CartPage` already shows, and `EmptyCart` when there are no lines. Give the cart's `select` a function defined once, not an inline arrow.
5. **Mobile first** (artikel 02): full width on a phone, a fixed width (say `sm:max-w-sm`) from `sm`, on the right. Tokens only: `bg-card`, `border-border`, `text-muted-foreground`, never a raw colour (artikel 04). Check both themes (artikel 05).
6. **Close it on navigation.** The "Lihat keranjang" link inside it goes to `/keranjang`; the drawer must close, and the focus must go where `useRouteFocus` puts it for the new page, not back to a button that is about to be hidden.
7. **During the start-up restore** the cart is not fetched (artikel 12). Make sure the drawer says "Memuat keranjang…" rather than "empty" in that moment, and that it shows the user's cart, merged, right after a login in another part of the page.
8. **Test it like the rest:** the dialog has a name (`aria-labelledby` on its heading), Tab stays inside, Escape closes, the focus comes back, no CSP violation and no console error in the e2e suite, and a screen reader hears the count change after an add (a live region that exists before it changes, artikel 07).


# Bab 11: checkout, payment and SEO

Bab 11 lets a buyer finish what the earlier chapters started: change the cart, choose an address and a courier, see the order's totals and apply a voucher, place the order, pay it with Midtrans, follow the payment until the API has decided, and find the order again later. Articles 01–06 do it in the Vite single-page app of Bab 7–10; from artikel 07 the storefront moves to the Next.js App Router for SEO, keeping these components.

The Bab 7–10 sections above describe the code as those chapters left it. The sections below say what Bab 11 changed.

## The mental model

| Idea | What it means | Go comparison |
|---|---|---|
| **The server computes the money** | Every amount a buyer is charged (shipping, discount, total) comes from the API's preview or order; the page only formats it. The cart's subtotal is a hint, as the contract says | The handler never trusts a total in the request body; the client mirrors that by never making one |
| **A retry is the same request** | A checkout carries an `Idempotency-Key`; a retry after a timeout sends the same key and body, and the API answers the first order instead of making a second | A request ID that makes a write safe to repeat, like an upsert keyed by it |
| **The browser is told, the server decides** | Midtrans' return page says "paid" in its query string; the storefront ignores it and asks the API, which only believes Midtrans' signed notification and status API | Never trust input; act on the source of truth |
| **Polling ends** | The payment page asks again while the order waits, slower each time, never while the tab is hidden, and stops on a final status | A ticker with backoff that stops on `ctx.Done()` |

## Where each Bab 11 article's ideas live

Paths are relative to `apps/web/src` unless they start with another top-level folder.

| Article | Concept | Where to read it |
|---|---|---|
| 01 | The full cart page | `features/cart/components/CartPage.tsx` (focus and announcement after a removal), `CartLineItem.tsx` (stepper, remove, the fix for each `problem`), `hooks/useChangeCartLine.ts` (PATCH/DELETE in the cart's queue, owner fixed at the click, optimistic quantity), `optimistic-cart.ts` (`withLineQuantity`), `cart-errors.ts` (`cartLineErrorMessage`), `CART_MUTATIONS` in `hooks/useAddToCart.ts`; `updateCartItem`, `removeCartItem` in `packages/shared/src/api/cart.ts` |
| 02 | Address form and courier choice | `features/checkout/components/CheckoutPage.tsx` (page state, derived choices, `RequireAuth` route), `AddressStep.tsx` (radio group in a `<fieldset>`, focus after save or cancel), `AddressForm.tsx` (React Hook Form + `addressSchema`, `autoComplete` tokens, API field errors), `CourierStep.tsx` (quotes, `SHIPPING_UNAVAILABLE` vs `UPSTREAM_UNAVAILABLE`), `shipping.ts` (`chosenAddressId`, `validShippingChoice`, `formatEtd`), `api/queries.ts` (`checkoutKeys`), `hooks/useCreateAddress.ts`, `checkout-errors.ts`; the "Lanjut ke checkout" button in `features/cart/components/CartPage.tsx`; `listAddresses`, `createAddress` (`packages/shared/src/api/addresses.ts`), `getShippingQuotes` (`api/checkout.ts`), `addressSchema` (`schemas/address.ts`) |
| 03 | Order summary and voucher | `features/checkout/components/SummaryStep.tsx` (each preview error's answer), `OrderSummary.tsx` (the API's `totals`, no arithmetic, `aria-busy` while a new preview loads), `CheckoutProblemList.tsx`, `VoucherForm.tsx` (apply through a preview, the cache seeded, focus after apply and remove), `previewQuery` and `cartSignature` in `api/queries.ts` (`keepPreviousData`), `voucherErrorMessage` in `checkout-errors.ts`; `previewCheckout` and `checkoutProblems` (`packages/shared/src/api/checkout.ts`), `voucherSchema` (`schemas/voucher.ts`) |
| 04 | Midtrans Snap in the frontend | `features/checkout/hooks/usePlaceOrder.ts` (the Idempotency-Key's lifetime, retries with the same key), `components/PlaceOrder.tsx`, `onPlace` and the placed state in `components/CheckoutPage.tsx`; `features/orders/hooks/usePayOrder.ts` (redirect flow, `isMidtransUrl`, the fake provider), `components/PayButton.tsx`, `components/PaymentPage.tsx`, `components/FakePaymentHint.tsx`, `components/PaymentReturnPage.tsx`, `payment-state.ts`, `payment-errors.ts`, `paths.ts`; the payment comment in `apps/web/Caddyfile`; `placeOrder`, `payOrder`, `getOrder` (`packages/shared/src/api/orders.ts`) |
| 05 | Payment status page with polling | `features/orders/components/PaymentPage.tsx` (`refetchInterval` as a function, `staleTime: 0`, the round and "Periksa lagi"), `payment-polling.ts` (`POLL_DELAYS_MS`, `POLL_LIMIT_MS`, `pollDelay`), `components/PaymentStatus.tsx` (one live region), `order-status.ts` (`paymentOutcome`, `canStartPayment`, the status labels) |

## The full cart page (artikel 01)

- **Every line can be changed where it is.** A stepper per line (`PATCH /v1/cart/items/{variant_id}` with the new quantity, capped at the stock and 99), a remove button (`DELETE`), and one fix for each `problem` the API reports: "Pakai harga baru" saves the same quantity again, which is how the contract accepts a changed price; "Ubah jadi N" lowers a line to the stock; an `unavailable` line can only be removed.
- **One queue for every write to the cart.** A line change runs in the add's `scope` (`"cart"`), so the writes of the whole storefront are sent one after another: two quick presses on + send 3 and then 4, never 4 first. `isMutating({ mutationKey: ["cart"] })` counts the add and the line changes together, so only the last write of a burst refetches the cart.
- **The buyer is fixed at the click.** A change clicked by a logged-in buyer whose session ends before its turn fails with `401` instead of being sent as a guest's, the same rule as Bab 10's add (artikel 14).
- **Optimistic quantity, computed from the cache at the click.** The guess is written synchronously in the hook's `change`, not in `onMutate` (which starts after an `await`), and a press on + or − is a *step* turned into a quantity from the cache as it is at that moment. Three presses faster than a render send 3, 4 and 5; computed from the quantity on screen, all three would have sent 3 (found in the browser). An error puts that press's snapshot back.
- **Confirmed removal.** A removal waits for the API, with the line marked busy (`aria-busy`, "Menghapus…"), because an optimistic removal would unmount the line and its error message with it.
- **Focus after a removal or a fix.** The removed line's button disappears with the line; the focus moves to the page's heading and a status line says which product was removed. "Pakai harga baru" and "Ubah jadi N" disappear with the problem they fix; the focus moves to the line's product link. The stepper's and the remove button's accessible names include the product and variant ("Tambah jumlah Kaos Polos, M"), so a list of buttons can tell five "+" apart.
- **The subtotal is a hint.** It moves with an optimistic change and is replaced by the API's answer. Shipping, the voucher and the total are the API's at checkout (artikel 03).

## Address and courier (artikel 02)

- **`/checkout` needs a login.** It is a lazy route under Bab 10's `RequireAuth`: a guest who presses "Lanjut ke checkout" goes to `/masuk?kembali=%2Fcheckout`, and the login merges the guest cart into theirs before coming back. The cart page disables the button (with the reason, through `aria-describedby`) while a line has a `problem`, because checkout would refuse it with `CHECKOUT_PROBLEMS`.
- **Choices are page state, and everything shown is derived.** The page keeps two `useState`s, the address the buyer picked and the courier service they picked (with the address it was picked for). `chosenAddressId` falls back to the default address (the API lists it first), and `validShippingChoice` drops a courier choice made for another address or no longer quoted. There is no effect that "selects the default" or "resets the courier" after a list arrives, so no render where the two disagree.
- **Addresses are radio buttons in a `<fieldset>`.** Native radios give one Tab stop for the group, arrow keys inside it and the legend as its name, with no JavaScript; each option shows the whole address, because "Rumah" alone does not say which house.
- **The form is the shared schema.** `addressSchema` in `packages/shared` mirrors the API's handler (trimmed text, lengths in characters, the sdk's `id_phone` and `id_postal` patterns) and is checked against the contract's `AddressCreate` with `satisfies`. It cleans a phone number typed with spaces or dashes before sending it. `autoComplete` uses the HTML tokens (`street-address`, `address-level2` for the city, `address-level1` for the province, `postal-code`, `tel`) so a browser can fill a saved address, and `inputMode` brings up a digit keyboard. The API's own field errors land under their fields (`setApiFieldErrors`, with the phone and postal code messages in Indonesian); `ADDRESS_LIMIT_REACHED` goes above the button.
- **Focus after the form closes.** Saving selects the new address and focuses its radio; "Batal" returns the focus to "Tambah alamat baru". Both through a ref read by an effect after the list is back on screen.
- **Quotes are hints.** The courier step shows `GET /v1/checkout/shipping-quotes` for the chosen address as the API priced it; checkout asks the courier again. `SHIPPING_UNAVAILABLE` (no courier serves the postal code) has no retry button, because only another address helps; `UPSTREAM_UNAVAILABLE` (the rates service did not answer) has one. Preview, quotes and checkout share one rate limit per buyer (30 a minute), so quotes stay fresh for the storefront's default half minute instead of being asked for on every render. The courier's estimate is in English ("2-3 days"); `formatEtd` translates only the unit.
- **A logout forgets it.** `onSessionEnd` (`app/App.tsx`) removes every `["checkout", …]` query, as it does the cart and the account.

## Order summary and voucher (artikel 03)

- **The browser never adds up money.** The summary shows `POST /v1/checkout/preview`'s `totals` (subtotal, discount, shipping fee, total) as the API computed them, in whole rupiah with a percent discount rounded once on the server (ADR 0006). A total added up on the page could disagree with the one charged by a rupiah, or by a courier fee that changed since the quote. The only arithmetic left in the storefront is the cart page's optimistic hint (artikel 01), which the contract calls a hint.
- **The preview is a query, although it is a POST.** It writes nothing and its answer is data the page shows, so it lives in TanStack Query's cache under `["checkout", userId, "preview", cartSignature, choice]`: the same choice twice costs one request, and another cart (changed on another tab or device) is another preview. The choice holds only what the buyer has chosen (`address_id`, then `courier` and `service`, then `voucher_code`). `keepPreviousData` keeps the last totals on screen, dimmed and `aria-busy`, while a new choice is priced. The first preview waits for the address list, so it is not priced once without the default address and again with it.
- **Each preview error has its own answer.** `CHECKOUT_PROBLEMS` lists the refused lines (read with `checkoutProblems` from `packages/shared`, a run-time check of `details.lines`, because an `ApiError`'s details are `unknown` until checked), named from the cart, with a link to the cart page where each is fixed; `VOUCHER_NOT_APPLICABLE` for a voucher already in use says why and offers "Hapus voucher"; anything else says what happened and offers "Coba lagi".
- **A voucher is applied by asking the API first.** "Pakai" sends a preview with the code; only an accepted code becomes part of the choice, and that preview is written into the cache under the key the page asks for next, so the summary shows the discount without a second request (preview, quotes and checkout share one rate limit per buyer). A refused code stays in the field with its reason (`not_found` also covers a promo that has not started, by the API's design; `expired`, `exhausted`, `per_user_limit`, `min_spend` with the amount). `voucherSchema` checks the shape (3–32 letters and digits) and sends it in capitals.
- **Focus.** After "Pakai" the field disappears and the confirmation ("Voucher POTONG15RB dipakai (Rp 15.000)") takes the focus; after "Hapus voucher" the field comes back and takes it. A refused code focuses the field with its error.

## Placing the order and paying with Midtrans Snap (artikel 04)

### Snap's redirect, not Snap.js

Midtrans offers Snap two ways: **Snap.js**, a script loaded into our page that opens the payment in a pop-up (`snap.pay(token)`, with `client_key`), and the **redirect**, a top-level navigation to the transaction's `redirect_url` on Midtrans' own hosted page. `POST /v1/orders/{id}/pay` answers both. The storefront uses the redirect:

- **No third-party script next to the token.** The access token lives in memory (Bab 10). Snap.js would run Midtrans' code, and whatever it loads, inside our page with full access to it; it is versioned by Midtrans, not us, so it cannot be pinned with Subresource Integrity. The redirect never runs Midtrans code on our origin.
- **No CSP change.** Snap.js needs Midtrans in `script-src`, its pop-up in `frame-src`, its calls in `connect-src` (and the exact list depends on the payment methods it loads, which we do not control). A top-level navigation is governed by no CSP directive, so the policy stays `script-src 'self'`, no `frame-src` beyond `default-src 'self'`, `connect-src` the API only. `Permissions-Policy: payment=()` stays too: nothing uses the browser's Payment Request API. The decision is written beside the policy in `apps/web/Caddyfile`.
- **The same flow as the mobile app** (Bab 13+), which opens `redirect_url` in the system browser.
- **The cost:** the buyer leaves the shop for Midtrans' page instead of a pop-up over it, and returns through Midtrans' "Finish Redirect URL", configured in the Midtrans dashboard as `<storefront>/pembayaran/selesai`.

Before leaving, `usePayOrder` replaces the current history entry with the order's payment page (so Back from Midtrans returns there, not to the emptied checkout) and remembers `{ orderId, code }` in sessionStorage. The return page reads only `order_id` from Midtrans' query string (`GS-…-K3D9QX`, our order code plus a suffix, ADR 0007), finds the remembered order whose code it starts with, and goes to that order's payment page. `transaction_status=settlement` in the URL is ignored: anyone can type it; the payment page asks the API, which trusts only Midtrans' signed notification confirmed by its status API. `redirect_url` itself is checked to be HTTPS on `midtrans.com` before the browser is sent there (`isMidtransUrl`).

### The test gateway (`APP_PAYMENT_PROVIDER=fake`)

Local development and the e2e stack run the API with the fake gateway (Bab 6, `make up` uses it). Its answer has `provider: "fake"`, a `token` of `fake-<uuid>`, a `redirect_url` on `fake-payment.invalid` (a reserved domain that never resolves), and `client_key: "goshop-fake-client-key"`. The storefront branches on `provider`, never on the URL: with `"fake"` it does not navigate anywhere outside, it goes to the order's payment page with `state: { fakeProvider: true }`, which shows how to pay from a terminal (`make fake-pay order=GS-…`, optionally `status=expire` or `status=deny`). The page then sees the result exactly as with Midtrans, by asking the API (artikel 05). The whole flow is demoable without a Midtrans account.

### One press: order, then payment

"Buat pesanan & bayar" sends `POST /v1/checkout`, then `POST /v1/orders/{id}/pay`. Once the order exists the checkout page shows it ("Pesanan GS-… sudah dibuat. Membuka pembayaran…") instead of the steps: the ordered lines have left the cart, and the refetched, empty cart must not replace the page. If the payment cannot be started (`PAYMENTS_DISABLED`, `PAYMENT_WINDOW_CLOSED`, Midtrans not answering), the order still exists: the buyer goes to its payment page with the reason and a "Bayar sekarang" button. The button is disabled with its reason (`aria-describedby`) until an address and a courier are chosen and the preview has answered; an error takes the focus (`FormAlert`); `CHECKOUT_PROBLEMS` lists the lines again and refetches the cart and the preview, `CART_CHANGED` refetches them, `VALIDATION_FAILED` and `SHIPPING_UNAVAILABLE` refetch the quotes.

### The Idempotency-Key

- **One key per checkout attempt**: created (`crypto.randomUUID()`) at the first press for a given body (address, courier, service, voucher), kept in a ref of the page, in memory only.
- **The same key for every retry of that body**: TanStack Query's automatic retries (up to 3, after 1 s, 2 s and 4 s) after a network failure, a client timeout, `IDEMPOTENCY_IN_PROGRESS`, `UPSTREAM_UNAVAILABLE` or a 502/503/504; the auth client's one retry after a refreshed token; and the buyer pressing the button again after an error. A checkout whose order was made but whose answer was lost gets that order back on the retry (the stored 201, `Idempotency-Replayed: true`), never a second one. Checked in the browser by letting the first request reach the API and dropping its answer: the retry carried the same key, got the replay, and the buyer has one order.
- **A new key when the body changes**: the same key with another body is `422 IDEMPOTENCY_KEY_REUSED`. A failed checkout frees its key on the server, so a change after a `409` or `422` is safe.
- **Dropped after success**: the next order is another attempt.
- **Not kept across a reload.** After an order went through, its lines have left the cart in the same transaction, so a reload with a new key finds `CART_EMPTY`, never a second order. The server's cart is the second guard (ADR 0006); the key covers everything the page retries by itself.
- The request may take 20 s (`placeOrder`'s `timeoutMs`), longer than the API's own 15 s: a checkout calls the courier and runs a transaction. Giving up earlier would still be safe, only slower.

## The payment status page (artikel 05)

`/pesanan/:id/pembayaran` shows what the API has decided about the order, by asking `GET /v1/orders/{id}` again while the order waits for its payment. The order moves only when the webhook (Midtrans' signed notification, confirmed by its status API) or the reconciler applies Midtrans' answer (ADR 0007); the page follows, it never decides.

| Order | Payment outcome (`paymentOutcome`) | The page says | Polling |
|---|---|---|---|
| `pending_payment` | `pending` | "Menunggu pembayaran", the deadline, "Lanjutkan pembayaran" while more than two minutes are left | yes |
| `pending_payment` past `payment_expires_at` | `pending` | "Batas waktu pembayaran sudah lewat. Menunggu konfirmasi akhir…" (the expiry job has not run yet) | yes |
| `paid`, `processing`, `shipped`, `completed` | `paid` | "Pembayaran diterima", with `paid_at` | stops |
| `cancelled` with `payment_expired` | `expired` | "Waktu pembayaran habis", stock returned | stops |
| `cancelled`, another reason | `cancelled` | "Pesanan ini dibatalkan" | stops |

**The polling policy** (`payment-polling.ts`):

- **Backoff:** 2 s, 2 s, 3 s, 5 s, 8 s, 13 s, 21 s, then every 30 s. Often at first, when a buyer back from Midtrans has usually just paid and the webhook lands within seconds; rarely later, because a virtual account can stay unpaid for hours and an open tab must not ask every 2 seconds all that time. Measured in the browser: requests at 0.5, 2.5, 4.5, 7.6 and 12.6 s.
- **Visibility:** TanStack Query does not run `refetchInterval` in a hidden tab (`refetchIntervalInBackground` stays `false`), and refetches a stale query when the tab is shown again. The query has `staleTime: 0`, so showing the tab asks at once. Measured: no request in 10 s hidden, one immediately on showing it.
- **Final states stop it:** `refetchInterval` is a function of the query that returns `false` once the outcome is not `pending`. Measured: no request in the 8 s after "Pembayaran diterima".
- **A limit:** a round lasts 15 minutes (`POLL_LIMIT_MS`, measured between the round's start and the last answer, so the render never reads the clock); then the page says "Pemeriksaan otomatis berhenti" and offers "Periksa lagi", which starts a new round.
- **Polling, not a push channel:** an order is paid once and the answer arrives within seconds of the webhook; a handful of GETs costs less than an SSE or WebSocket endpoint held open by every buyer on this page.

**Announced once.** The outcome sentence is the only text in a `role="status"` region that is always rendered: a poll that brings the same answer renders the same text and nothing is read out; the change to "Pembayaran diterima" is. "Terakhir diperiksa 16.36.20", which changes at every poll, sits outside it.

**What the buyer cannot see yet:** a payment Midtrans **denied** (or that failed or was cancelled at Midtrans) leaves the order `pending_payment` (ADR 0007: the buyer may pay again until the deadline), and the order response has no payment field, so this page cannot say "Pembayaran ditolak". It keeps saying "Menunggu pembayaran" and offers "Lanjutkan pembayaran", which creates a new payment. The API change that would let it say so is requested in the Bab 11 frontend report (a `payment` summary on the order).
