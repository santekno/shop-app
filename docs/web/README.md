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
| 04 | Midtrans Snap in the frontend | `features/checkout/hooks/usePlaceOrder.ts` (the Idempotency-Key's lifetime, retries with the same key), `components/PlaceOrder.tsx`, `onPlace` and the placed state in `components/CheckoutPage.tsx`; `features/orders/hooks/usePayOrder.ts` (redirect flow, `isMidtransUrl`, the fake provider), `components/PayButton.tsx`, `components/PaymentPage.tsx`, `components/FakePaymentHint.tsx`, `components/PaymentReturnPage.tsx`, `payment-state.ts`, `payment-errors.ts`, `paths.ts`; the payment comment beside the CSP (`apps/web/Caddyfile` until artikel 08, `src/proxy.ts` since); `placeOrder`, `payOrder`, `getOrder` (`packages/shared/src/api/orders.ts`) |
| 05 | Payment status page with polling | `features/orders/components/PaymentPage.tsx` (`refetchInterval` as a function, `staleTime: 0`, the round and "Periksa lagi"), `payment-polling.ts` (`POLL_DELAYS_MS`, `POLL_LIMIT_MS`, `pollDelay`), `components/PaymentStatus.tsx` (one live region), `order-status.ts` (`paymentOutcome`, `canStartPayment`, the status labels) |
| 06 | Order history and detail | `features/orders/components/OrdersPage.tsx` (infinite query, "Muat lebih banyak", focus on the first new order, "Bayar" for an unpaid order), `OrderDetailPage.tsx` (the order's own snapshots, timeline, `PayButton`), `OrderStatusBadge.tsx`, `ordersQuery` in `api/queries.ts` (`staleTime: 0`), `orderStatusText` and `ORDER_STATUS_LABEL` in `order-status.ts`; "Pesanan saya" in `features/auth/components/AccountMenu.tsx`; the `muted` variant in `components/ui/Badge.tsx`; `listOrders` (`packages/shared/src/api/orders.ts`) |
| 07 | Why an SPA is weak for SEO | the section below; `apps/web/scripts/seo-probe.js` (what a crawler without JavaScript reads) |
| 08 | Next.js App Router: server vs client components | the section below; `app/` (folders as routes, `layout.tsx`, `(auth)` and `(akun)` route groups, `not-found.tsx`, `error.tsx`, `healthz/route.ts`), `components/layout/` (`Providers`, `SiteFrame`, `client-pages`, `ErrorPage`, `NotFoundPage`), `components/navigation/` (`NavLink`, `Redirect`), `proxy.ts` (CSP nonce), `lib/navigation-state.ts`, `getQueryClient` in `lib/query-client.ts`, `lib/server-config.ts`, `features/theme/useTheme.ts`, `next.config.ts`, `postcss.config.mjs` |
| 09 | Product pages with SSR and the data cache | the section below; `lib/server-api.ts` (`serverApi`, `REVALIDATE_SECONDS`), `features/product/api/server.ts` (`getProductForPage`, `cache()`), `app/produk/[slug]/page.tsx` (`generateMetadata`, `notFound()`, `HydrationBoundary`), `app/page.tsx` (filters from `searchParams`, the first page and the categories prefetched), the `client` parameter of `productQuery`, `productListQuery` and `categoriesQuery` |
| 10 | Metadata, Open Graph and structured data | the section below; `siteUrl()` in `lib/server-config.ts` (`SITE_URL`), `generateMetadata` in `app/layout.tsx` (`metadataBase`), `app/page.tsx` and `app/produk/[slug]/page.tsx`; `features/catalog/catalog-metadata.ts` (which catalog URLs are indexed), `features/catalog/api/server.ts`; `features/product/structured-data.ts` (`Product`, `Offer`/`AggregateOffer`, `BreadcrumbList`), `components/JsonLd.tsx` (`serializeJsonLd`), `lib/site-metadata.ts`; the category link in `ProductDetail.tsx` |
| 11 | Sitemap and robots.txt | the section below; `app/sitemap.ts` (canonical paths from `catalogPageMeta`, `force-dynamic`), `listProductsForSitemap`, `SITEMAP_PRODUCT_LIMIT` and `SITEMAP_REVALIDATE_SECONDS` in `features/catalog/api/server.ts`; `app/robots.ts` |
| 12 | Product photos and Core Web Vitals | the section below; `features/catalog/components/ProductImage.tsx` (`srcset` from `variants`, `width`/`height`, `ImageLoading`), `CARD_IMAGE_SIZES` in `ProductCard.tsx`, `EAGER_IMAGES` in `ProductGrid.tsx`, the main photo in `features/product/components/ProductDetail.tsx` (`loading="priority"`); `imageOrigin()` in `lib/server-config.ts` (`IMAGE_ORIGIN`) and `img-src` in `proxy.ts`; `ProductImage`, `ImageVariant` in `packages/shared/src/api/types.ts` |
| 13 | Analytics and e-commerce events | the section below; `packages/shared/src/analytics/ecommerce.ts` (`EcommerceEvent`, the item and event builders, no PII); `lib/analytics.ts` (`track`); `features/analytics/` (`gtag-init.ts`: the inline script and Consent Mode's default, `consent.ts`: the stored answer and `consent update`, `components/AnalyticsConsent.tsx`: the banner and "Pengaturan analytics", `useTrackOnce.ts`, `purchase.ts`: `trackPurchaseOnce`); `analyticsId()` in `lib/server-config.ts` (`GA_MEASUREMENT_ID`), the Google hosts in `proxy.ts`, the scripts in `app/layout.tsx`, the footer in `components/layout/SiteFrame.tsx`; each event's call site in the table below |
| 14 | Deploying the storefront | the section below; `apps/web/Dockerfile` (the standalone server on `node:24-alpine`), `output: "standalone"` in `next.config.ts`, the `web` service in `docker-compose.yml`, `deploy/railway/web.json`, `app/healthz/route.ts`; `apps/web/Caddyfile` is gone |
| 15 | Recap and challenge | the two sections below; no code |

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
- **No CSP change.** Snap.js needs Midtrans in `script-src`, its pop-up in `frame-src`, its calls in `connect-src` (and the exact list depends on the payment methods it loads, which we do not control). A top-level navigation is governed by no CSP directive, so the policy stays `script-src 'self'`, no `frame-src` beyond `default-src 'self'`, `connect-src` the API only. `Permissions-Policy: payment=()` stays too: nothing uses the browser's Payment Request API. The decision is written beside the policy (in `apps/web/Caddyfile` at the time; in `src/proxy.ts` since artikel 08).
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
| `pending_payment` | `pending` | "Menunggu pembayaran" (or why the last payment ended, below), the deadline, a pay button while more than two minutes are left | yes |
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

**Why an order still waits** (`latest_payment`, `paymentAttempt` in `order-status.ts`). A payment Midtrans **denied**, that failed, that the buyer cancelled at Midtrans, or whose own Snap window closed leaves the order `pending_payment` (ADR 0007: the buyer may pay again until the order's deadline). The order's `latest_payment` (status, `expires_at`, `updated_at`, `null` before the first attempt; no token, no gateway id, no amount) says which, and the page says it while the order may still be paid:

| `latest_payment.status` | `paymentAttempt` | The page says | The button |
|---|---|---|---|
| none yet | `none` | "Menunggu pembayaran." | "Bayar sekarang" |
| `pending`, `challenge` | `open` | "Menunggu pembayaran." | "Lanjutkan pembayaran" |
| `paid` (the order has not caught up) | `confirming` | "Pembayaran sedang dikonfirmasi…" | none: a second payment would charge twice |
| `denied` | `denied` | "Pembayaran ditolak. Coba lagi, dengan metode pembayaran lain bila perlu." (a warning icon) | "Coba bayar lagi" |
| `failed` | `failed` | "Pembayaran gagal diproses. Silakan coba lagi." | "Coba bayar lagi" |
| `cancelled` | `cancelled` | "Pembayaran dibatalkan. Anda masih bisa membayar pesanan ini." | "Coba bayar lagi" |
| `expired` | `expired` | "Sesi pembayaran sebelumnya habis waktunya. Anda masih bisa membayar pesanan ini." | "Coba bayar lagi" |

The order's `status` still decides: `latest_payment` is read just after the order, so it may be newer, never older. A refused payment does not stop the polling (the buyer may pay again from another tab); past the order's deadline the page says what the table above says, whatever the last attempt was. The order's page (`/pesanan/:id`) uses the same button text (`payButtonText`).

## Order history and detail (artikel 06)

- **`/pesanan`** lists the buyer's orders, newest first, ten per page, from `GET /v1/orders` with cursor pagination: an infinite query, as the catalog's (Bab 9), whose next page parameter is `page.next_cursor` until it is null. "Muat lebih banyak" is a button, not infinite scroll: a history is short and rarely read, and the footer must stay reachable by keyboard. When the next page arrives the focus moves to its first order, where reading continues (the button disappears with the last page). The query has `staleTime: 0`, so opening the list always asks again: an order paid a moment ago on the payment page must not show "Menunggu pembayaran" here for half a minute.
- **Statuses** have one label each (`ORDER_STATUS_LABEL`: Menunggu pembayaran, Dibayar, Diproses penjual, Dikirim, Selesai, Dibatalkan) and a badge: waiting for payment, the one status that asks something of the buyer, stands out; a cancelled order is red; the rest are quiet (a new `muted` badge variant, `foreground` on `muted`). The colour only repeats the text. A cancelled order says why (`payment_expired`, `buyer_cancelled`, `seller_cancelled`).
- **An unpaid order** has "Bayar" in the list (a link to its payment page, named "Bayar pesanan GS-…" for a screen reader) and, on its page, "Bayar sekarang" (the same `PayButton`, while more than two minutes are left) and "Lihat status pembayaran".
- **`/pesanan/:id`** shows the order's own copy made at checkout (ADR 0006): product and variant names, unit prices, the voucher code, the shipping address, the courier and service, the airway bill once shipped, the totals, and the moments that happened (created, paid, shipped, completed, cancelled). It never looks the products up again: a product renamed or repriced since does not change a past order. Another buyer's order, or an id that is not a UUID, is the API's `404`, shown as "Pesanan ini tidak ditemukan".
- **Reached from** "Pesanan saya" in the account menu, the order code on the payment page, the Midtrans return page when it cannot tell which order it was, and checkout's `TOO_MANY_PENDING_ORDERS` message. A logout removes every `["orders", …]` query.

## Why a single-page app is weak for SEO (artikel 07)

Until artikel 08 the storefront is the Vite single-page app of Bab 7–10. Its server (Caddy, or `vite preview`) sends **the same `index.html` for every path**: an empty `<div id="root">`, one script and one stylesheet. Everything a buyer reads is drawn later in the browser by JavaScript that asks the API. A buyer does not notice; a crawler does.

### What a crawler gets, measured

`apps/web/scripts/seo-probe.js` fetches one URL the way a search engine's first pass does (Googlebot's user agent, no JavaScript) and reports what the HTML carries. Against the SPA (built with `VITE_API_URL` pointing at the seeded API, served by `vite preview`):

```text
$ node apps/web/scripts/seo-probe.js http://localhost:34173/produk/kaos-polos-hitam
status                 200
HTML (bytes)           1425
title                  GoShop
description            GoShop: toko online contoh dari kursus Fullstack Santekno.
canonical              —
og:title               —
og:image               —
h1                     —
links (<a href>)       0
images (<img>)         0
JSON-LD                —
visible text (chars)   6
visible text (start)   GoShop
```

The catalog (`/`) answers the same 1 425 bytes, and so does `/produk/tidak-ada`, **with status 200**. A headless Chromium with JavaScript disabled finds no `<h1>` on either page. With JavaScript, on a phone profile (412×823, 4× CPU slowdown, 150 ms latency, 1.6 Mbit/s; median of 5 runs, Playwright), the product's `<h1>` appears after about 2.0 s and the largest paint is at 1.6 s, after 12 requests: HTML, then the bundle, then the API.

| What the HTML lacks | What it costs |
|---|---|
| A title and description per page | every result in a search engine reads "GoShop" with the same sentence; the per-page `document.title` (`useDocumentTitle`) exists only after JavaScript ran |
| Content | Googlebot renders JavaScript, but in a second wave, queued after the crawl, on a budget; the API call must succeed from Google's renderer within its time limits. Bing, DuckDuckGo's crawler and most others render less or not at all |
| Links | a crawler discovers pages by following `<a href>`; with 0 links in the HTML, the products are found only after rendering, or through a sitemap (artikel 11) |
| A real 404 | a missing product answers 200 with an error drawn by JavaScript: a "soft 404" that Google may index as a page, and that wastes crawl budget |
| Open Graph tags | WhatsApp, Facebook, X, Telegram and Slack never run JavaScript: a shared product link shows no name, no price and no photo |
| Fast first content | the LCP waits for the HTML, the JavaScript bundle, its parse and run, and an API round trip, one after another |

### What stays a client-rendered page

Only public pages need to be found: the catalog and the product pages. The cart, checkout, payment, orders and account pages are behind a login or private to one browser, must never be indexed, and depend on the buyer's session, which lives in the browser (the access token in memory, the refresh cookie on the API's path, Bab 10). They keep rendering in the browser after the move; they get `noindex` (artikel 10) instead of server rendering.

So the move to Next.js (artikel 08) is about **where the first HTML is made** for public pages, not about rewriting the shop: the same components render on the server for the catalog and the products, and in the browser for everything personal.

## Next.js App Router: server and client components (artikel 08)

From this article the storefront is a Next.js 16 app (App Router, `next` 16.4.3 pinned in the pnpm catalog). The components of Bab 7–11 are kept; what moved is **routing** (React Router's route objects became folders under `src/app/`) and **where the first HTML is made**.

### The routes, as folders

| URL | File | Rendered |
|---|---|---|
| `/` | `app/page.tsx` → `CatalogPage` | on the server, then hydrated |
| `/produk/[slug]` | `app/produk/[slug]/page.tsx` → `ProductDetailPage` (+ its own `not-found.tsx`) | on the server, then hydrated |
| `/keranjang` | `app/keranjang/page.tsx` | browser only |
| `/masuk`, `/daftar` | `app/(auth)/…/page.tsx` inside `app/(auth)/layout.tsx` (`AuthLayout`) | browser only |
| `/akun`, `/checkout`, `/pesanan`, `/pesanan/[id]`, `/pesanan/[id]/pembayaran`, `/pembayaran/selesai` | `app/(akun)/…/page.tsx` inside `app/(akun)/layout.tsx` (`RequireAuth`) | browser only |
| anything else | `app/not-found.tsx` | on the server, **status 404** |
| `/healthz` | `app/healthz/route.ts` | a route handler: `ok` |

The URLs are the Vite app's, so links, bookmarks and the e2e suite's paths still work. `(auth)` and `(akun)` are **route groups**: the parentheses keep the folder out of the URL; each gives its pages one layout and one `robots` setting (`noindex`).

### Server components and client components

- **A server component** (the default: every `page.tsx` and `layout.tsx` here) runs on the server for each request, can be `async` and read the request (`headers()`), and sends HTML; its code never reaches the browser. It cannot hold state, run effects or handle a click.
- **A client component** starts with `"use client"`. It renders on the server too (for the first HTML), then again in the browser, where it is **hydrated**: React attaches state and event handlers to the HTML that is already there. Everything it imports is part of the browser's JavaScript.
- The boundary is the file with `"use client"`: `components/layout/Providers.tsx` (TanStack Query, the session), `SiteFrame.tsx` (skip link, header, focus after navigation), `CatalogPage.tsx`, `ProductDetailPage.tsx`, `NotFoundPage.tsx`, `ErrorPage.tsx`/`app/error.tsx`, `RequireAuth.tsx`, `NavLink`, `Redirect`, `client-pages.tsx`. The components they import (the cards, the forms, `components/ui`) need no directive: they are client code because a client component imports them.
- A server component can render a client component and pass it server-rendered `children`: the root layout renders `<Providers><SiteFrame>{children}</SiteFrame></Providers>` and the page stays a server component.

### Rendered on the server, or in the browser only

The catalog and the product pages are public: rendered on the server, they give a crawler the HTML artikel 07 found missing (artikel 09 fills it with the API's data). Every other page depends on what only the browser has: the session (the access token in memory, restored from the `HttpOnly` cookie that is sent to the API's path, never to this server, Bab 10), the guest cart token in `localStorage`, the remembered payment in `sessionStorage`. On the server they could only say "Memeriksa sesi Anda…". So `components/layout/client-pages.tsx` loads each with `dynamic(…, { ssr: false })`, Next.js' `lazy()`: the server sends "Memuat GoShop…", the page's code is a chunk of its own (the same `lazy.ts` loaders the React Router routes used), and the component renders in the browser exactly as before. The web session, the refresh interceptor, the Web Locks, the guest cart merge, `RequireAuth`'s wait-then-redirect, and TanStack Query for everything personal are unchanged.

### What replaced React Router

| React Router (Bab 9–10) | Next.js (Bab 11) |
|---|---|
| `routes.tsx`, `createBrowserRouter` | folders under `src/app/` |
| `<Outlet />` in a layout route | `children` of `layout.tsx` |
| `<Link to>` | `<Link href>` from `next/link` |
| `<NavLink>` (sets `aria-current`) | `components/navigation/NavLink.tsx` (`usePathname`) |
| `useNavigate()` | `useRouter().push/replace/back` from `next/navigation` |
| `<Navigate replace>` | `components/navigation/Redirect.tsx` (browser decisions); `redirect()` on the server |
| `useParams`, `useSearchParams` | the same names from `next/navigation` (`useSearchParams` is read-only; a filter change is `router.push`), or `params` given to the page |
| `useLocation().state` | `lib/navigation-state.ts` (below) |
| `lazy` routes | automatic per-page code splitting; `dynamic()` for the browser-only pages |
| a route's `ErrorBoundary` | `app/error.tsx` (`ErrorPage`) |
| the `*` route, a soft 404 | `app/not-found.tsx` and `notFound()`, with HTTP status 404 |
| `useDocumentTitle` | `metadata` in each `page.tsx` (`title` template `%s — GoShop` in the root layout) |
| `ScrollRestoration` | built in |
| `NavigationProgress` (`useNavigation`) | removed; see below |

- **Navigation state.** React Router could attach `state` to a history entry; Next.js' router keeps `history.state` for itself. Four small hand-overs used it: the catalog card telling the product page it came from the list (so "Kembali ke katalog" is `history.back()`), the register page passing the new email to `/masuk`, and checkout or "Bayar" passing "fake gateway" or "the payment could not start" to the payment page. `lib/navigation-state.ts` keeps one such value in `sessionStorage` under the path it is meant for: it survives a reload of that page, and the next navigation to another path forgets it (`SiteFrame`). A render reads it with `useSyncExternalStore`, whose server snapshot is "nothing", so the HTML and the first browser render agree.
- **Midtrans' Back button.** The Vite app awaited the router before leaving for Midtrans, so Back returned to the payment page. Next.js' `router.replace` returns nothing to await; `usePayOrder` now switches the history entry with `history.replaceState` (Next.js keeps its router in step with it) and reloads the page if the browser restores the old one from its back/forward cache.
- **No navigation progress bar.** Next.js has no global "navigating" state; the usual answer, a `loading.tsx`, streams the page behind a Suspense boundary, and a page that has started streaming can no longer answer 404: a missing product would be a 200 again. The product and catalog pages answer quickly from the data cache (artikel 09); a `loading.tsx` may be added under `(akun)`, where no status matters.
- **Focus after a navigation** stays ours (`useRouteFocus`, now with `usePathname`): Next.js scrolls to the top and announces the new title, but moves no focus.

### The QueryClient on the server

`getQueryClient()` (`lib/query-client.ts`) returns a **new client on every server call** and **one client for the whole visit in the browser**. A module-level client on the server would live as long as the process and be shared by every visitor: one buyer's cart or orders could reach another buyer's HTML. The Zustand cart store is still a module-level singleton; on the server it never holds a token (`safeLocalStorage` finds no `localStorage` and the store starts empty), and nothing personal is rendered on the server.

### Theme, CSP and the nonce (the decision)

A server-rendered Next.js page carries **inline scripts**: the React Server Components payload React hydrates from (`self.__next_f.push(…)`). Bab 7–10's `script-src 'self'` refuses them. The choices:

| Option | Inline scripts | Cost |
|---|---|---|
| `'unsafe-inline'` | allowed, ours and any injected one | the CSP no longer stops script injection: rejected |
| hashes, or the experimental SRI build option | only for files known at build time; the RSC payload differs per page and request | not workable for dynamic pages |
| **a nonce per request** (chosen) | only those carrying this request's nonce | every page renders per request: no full-route cache, no static HTML on a CDN |

`src/proxy.ts` (Next.js 16's name for middleware) makes a random nonce per request, sends `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'nonce-…'; img-src 'self' data:; connect-src 'self' <API origin>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, and passes the nonce to the page in the request headers, where Next.js puts it on its own scripts. In development it adds `'unsafe-eval'` (React rebuilds server error stacks with `eval`) and `style-src 'unsafe-inline'` (hot reload's `<style>` elements). No `'strict-dynamic'`: with it browsers ignore `'self'`, and every script Next.js loads later would need the nonce too. The other headers Caddy sent (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) come from `headers()` in `next.config.ts`; `X-Powered-By` is off.

**The theme stays a file.** With a nonce available, an inline script would be allowed, but `public/theme.js` keeps working under any CSP, is cached, and needs no change: the root layout renders `<script src="/theme.js">` in `<head>` (synchronous on purpose, so the `@next/next/no-sync-scripts` rule is silenced on that line with the reason), and `<html suppressHydrationWarning>` accepts the `data-theme` it sets before React hydrates. `useTheme` reads the choice and the device's preference with `useSyncExternalStore` and a server snapshot ("no choice, light"), so the server's HTML and the first browser render agree and the button corrects itself right after; the colours never wait, because the CSS reads `data-theme` and the media query.

The cost of the nonce is measured in artikel 09: about 3.5 ms of rendering per page, with the data still cached.

### Configuration

- `NEXT_PUBLIC_API_URL` (build time, public): the API as the browser reaches it; `next build` refuses to run without it (`next.config.ts`), as Vite did with `VITE_API_URL`. Unset in development means `http://localhost:8080`.
- `API_INTERNAL_URL` (run time, server only, `lib/server-config.ts` with `import "server-only"`): the API as the storefront's server reaches it (`http://api:8080` in Compose); unset means the public URL.
- `next dev` runs on port 5173, the origin the API's CORS default allows.
- `next.config.ts`: `output: "standalone"` (artikel 14), `outputFileTracingRoot` and `turbopack.root` at the workspace root and `transpilePackages: ["@goshop/shared"]` (the shared package ships TypeScript), `poweredByHeader: false`.
- Tailwind CSS v4 runs as a PostCSS plugin (`postcss.config.mjs`, `@tailwindcss/postcss`) instead of the Vite plugin; `src/index.css`, the tokens and dark mode are unchanged.
- ESLint adds `@next/eslint-plugin-next`'s Core Web Vitals rules; `eslint-plugin-react-refresh` (a Vite concern) is gone. `next-env.d.ts` is generated by `next typegen` (run by `typecheck`) and ignored by git.
- `vite.config.ts` now only configures Vitest; the unit tests are excluded from `tsc` and ESLint until the test stage moves them to Next.js (they mount React Router's `MemoryRouter`).

## Product pages from the server: SSR and the data cache (artikel 09)

The catalog and the product pages now fetch the API **on the server**, so the HTML a crawler (or a slow phone) receives already holds the products.

### The data flow

1. **The server fetches**, through `serverApi` (`lib/server-api.ts`, `import "server-only"`): the same `@goshop/shared` client as the browser's, pointed at `API_INTERNAL_URL`, with a `fetch` that passes `next: { revalidate, tags }`. Next.js keeps each GET answer in its **data cache**, shared by every request this server handles: within `revalidate` seconds no visitor's page reaches the API; after it the cached answer is still served at once and refreshed in the background (stale-while-revalidate, ISR applied to the data). Only public data goes through it, never a request with a buyer's token.
2. **The page renders with it.** `app/produk/[slug]/page.tsx` is an `async` server component: `getProductForPage(slug)` (`features/product/api/server.ts`) returns the product, or `null` for the API's `NOT_FOUND`, and `null` is `notFound()`: **HTTP 404** with `produk/[slug]/not-found.tsx`. Any other error is thrown: **500** with `app/error.tsx`, so a search engine retries later instead of indexing an error. `generateMetadata` gives the page the product's name as its `<title>` and the start of its description; `getProductForPage` is wrapped in React's `cache()`, so the metadata and the page share one fetch per request (Next.js' own memoisation of equal fetches does not apply: the client passes an `AbortSignal` for its timeout).
3. **The browser reuses it.** The client components still read the data with TanStack Query. The server fills a QueryClient of its own (`getQueryClient()`, one per request) under the same keys, and `<HydrationBoundary state={dehydrate(queryClient)}>` sends that cache inside the page's payload: `useQuery(productQuery(slug))` and `useInfiniteQuery(productListQuery(…))` start with the server's data, fresh for the storefront's 30 s stale time. The query options take the client as a parameter (`productQuery(slug, client)`), which is how the server and the browser agree on the keys while fetching from different addresses.
4. **The catalog** (`app/page.tsx`) reads the filters from `searchParams` with the same `readCatalogFilters` as the browser, and fetches the first page (`CATALOG_PAGE_SIZE`, 12) and the categories. The next pages ("Muat lebih banyak", infinite scroll) still come from the browser. A failed prefetch is swallowed: nothing is dehydrated, and the browser asks again and shows its error with a retry, as before (a category that does not exist is still the client's message, with status 200; artikel 10 keeps such pages out of the index).

| Data | `revalidate` | Tags | Why that long |
|---|---|---|---|
| a product | 60 s | `products`, `product:<slug>` | price and stock change, but a minute late is fine on a product page: the cart and checkout ask the API themselves, and the checkout preview decides price and stock |
| a page of products | 60 s | `products` | the same |
| the categories | 300 s | `categories` | an admin adds one now and then |

The tags are for `revalidateTag()` when Bab 12's admin changes a product. The data cache lives in `.next/cache/fetch-cache` on the server's disk: it survives a restart of the process, but each container has its own (artikel 14).

### Measured

Against the seeded API on the same laptop (`next start`, production build; 28 products, each visited once with an empty data cache, then three more times):

| Request | Median | p95 |
|---|---|---|
| product page, data cache **miss** (first visit of a slug) | 9.1 ms | 23.7 ms |
| product page, data cache **hit** | 3.5 ms | 5.1 ms |
| the API's `GET /v1/products/{slug}` alone | 2.0 ms | 5.7 ms |
| a static file (`/theme.js`, a `_next/static` chunk) | 0.7 ms | 1.2 ms |

- **The data cache:** five page views of one product within a minute sent **one** request to the API (its log), and the title and the page together one. The browser sends none for the product, the catalog or the categories after the page loads (only the session's `POST /v1/auth/web/refresh`). Here the API answers in 2 ms; against a database under load, or an API in another region, the miss grows and the hit does not.
- **The nonce's price:** with a per-request nonce (artikel 08) every page is rendered for each request, about 3.5 ms of server work even when all its data is cached, against 0.7 ms for a file served as it is, which is what a fully static (full-route-cached) page would cost. Under load (10 concurrent clients for 5 s) one Node process served about **540 product pages a second**, against about **6 700** static chunks. For a shop this size the render is cheap and the API is spared by the data cache; a shop that needs a CDN in front of its HTML would trade the nonce for static pages and a weaker CSP, and should measure first.
- What the crawler gets now (`seo-probe.js`): `/produk/kaos-polos-hitam` answers 200 with 18 KB of HTML, `<title>Kaos Polos Hitam — GoShop</title>`, the description, `<h1>Kaos Polos Hitam</h1>` and the product's text; `/` answers 40 KB with the twelve product cards and 29 links; `/produk/tidak-ada` answers **404**. Before (artikel 07): 1 425 bytes, no h1, no links, 200 everywhere.

## Metadata, Open Graph and structured data (artikel 10)

### The base URL

Every absolute URL a page prints (the canonical link, `og:url`, the structured data, the sitemap in artikel 11) is built on **`SITE_URL`**, the storefront's public origin, read by the server when a page renders (`siteUrl()` in `lib/server-config.ts`). Never from the request's `Host` header: the client chooses that header, and a page must not tell search engines that the shop lives at an attacker's host. The root layout's `generateMetadata` sets it as `metadataBase`, so pages give relative paths. Unset in development means `http://localhost:5173`; unset in production is a configuration error, and pages answer 500 with the reason in the log instead of naming `localhost` as the shop's address. `next build` does not need it.

### What each page tells search engines and link previews

| Page | `<title>` | Canonical | Robots | Open Graph / Twitter |
|---|---|---|---|---|
| `/` | Katalog — GoShop | `/` | index | site defaults, `og:url` |
| `/?kategori=kaos` (exists) | Kaos — GoShop | `/?kategori=kaos` | index | title, description, `og:url` |
| `/?kategori=kaos&urut=termurah` | Kaos — GoShop | `/?kategori=kaos` (no sort) | index | as above |
| `/?q=kaos` | Hasil pencarian “kaos” — GoShop | none | `noindex, follow` | no `og:url` |
| `/?kategori=tidak-ada` | Kategori tidak ditemukan — GoShop | none | `noindex, follow` | no `og:url` |
| `/?urut=xyz&utm_source=wa` | Katalog — GoShop | `/` | index | `og:url` `/` |
| `/produk/kaos-polos-hitam?utm_source=wa` | Kaos Polos Hitam — GoShop | `/produk/kaos-polos-hitam` | index | title, description (≤ 160 characters, cut at a word), `og:url`; `og:image` and a large Twitter card once the product has a photo (artikel 12), a small card until then |
| `/produk/tidak-ada` (404) | Produk tidak ditemukan — GoShop | none | `noindex` (Next.js adds it to a `notFound()` page) | — |
| `/keranjang`, `/masuk`, `/daftar`, `(akun)` pages | the page's | none | `noindex` (artikel 08) | — |

**The catalog's rule** (`catalogPageMeta`, `features/catalog/catalog-metadata.ts`). Each combination of the three filters is a URL a crawler can find; indexing all of them would split the shop into near-copies of one list.

- **A category** is a real page (its own products, a name buyers search for): indexed, with its own canonical URL. Its title and description come from the categories the server already fetches (`getCategoriesForPage`, once per request, shared with the page).
- **Sorting** shows the same products in another order: the canonical link points at the unsorted URL, so search engines merge the two. Not `noindex` as well: "index my canonical" and "do not index me" on one page contradict each other.
- **A search** is the shop's own search engine; Google asks sites to keep internal search results out of its index. `noindex, follow`: the products it links to are still found.
- **An unknown category** shows the browser's "Kategori ini tidak ada" with status 200; `noindex` keeps that page out.
- Whatever `readCatalogFilters` ignores (a malformed slug, an unknown sort word, `utm_*` and other parameters) is dropped from the canonical URL, because it is built from the parsed filters.
- If the API does not answer the categories, the category cannot be checked and the page is treated as one that exists.

Next.js merges metadata one top-level key at a time: a page that sets `openGraph` replaces the layout's, so pages spread `baseOpenGraph` (`lib/site-metadata.ts`: `siteName`, `locale: id_ID`, `type: website`). Next.js' `openGraph` types have no `og:type=product`; `website` is what Open Graph's own spec covers.

### Structured data: Product, Offer, BreadcrumbList

`app/produk/[slug]/page.tsx` renders two JSON-LD blocks with `components/JsonLd.tsx`, from `features/product/structured-data.ts`:

- **`Product`**: `name`, `description`, `url`, `@id`, `category`, `image` (the photo URLs, only when there are photos), and `sku` when there is one variant. **No `brand`** (the catalog has none, and the shop is not the maker), **no rating or reviews** (GoShop has none). Structured data says only what the page shows; search engines compare the two.
- **The price**: one variant is an **`Offer`** (`price` as the number of whole rupiah, `priceCurrency: "IDR"`, `availability` `InStock`/`OutOfStock` from the stock, `itemCondition: NewCondition`, the seller). Several variants are an **`AggregateOffer`** (`lowPrice`, `highPrice`, `offerCount`, in stock if any variant is) whose `offers` list each variant as its own `Offer` with its SKU, name, price and stock. Not a `ProductGroup` with `hasVariant`: Google requires `variesBy` (size, colour …), and a GoShop variant is a free name ("M", "500 g", "Hitam") with no typed attribute to state truthfully.
- **`BreadcrumbList`**: Katalog › the product's category (`/?kategori=…`) › the product. The product page now links its category name to that list, so the trail is on the page too, and a crawler finds every category page from its products.

**Serialised safely.** The JSON goes into the HTML as raw text, and `JSON.stringify` leaves `<` alone: a product described as `</script><script>alert(1)</script>` would close the block and start a real script. `serializeJsonLd` writes `<`, `>` and `&` as `\u003c`, `\u003e`, `\u0026` (and U+2028/U+2029 as escapes): the same value for a JSON parser, no markup for the HTML parser. No nonce: a `type="application/ld+json"` block is never run, so `script-src` does not apply to it.

### Checked

- With the description of `kaos-polos-hitam` set to `Kaos katun combed 30s. Uji: </script><script>alert(1)</script> & <!-- komentar --> selesai.` in the database: the block reads `…Uji: \u003c/script\u003e\u003cscript\u003ealert(1)…`, the HTML has as many `</script>` as `<script` elements, the description round-trips exactly through `JSON.parse`, the `<meta name="description">` and `og:description` are HTML-escaped (`&lt;/script&gt;`), and in Chromium no dialog opens and the console stays empty.
- A scratch check parses every JSON-LD block of a page and compares it with the API's product: the shapes Google documents for product snippets (`name`, an `offers` with `price` as a number, `priceCurrency`, `availability` as a schema.org URL; `AggregateOffer` with `lowPrice`, `highPrice`, `offerCount`), each variant's SKU, price and stock, absolute URLs, breadcrumb positions 1–3, no brand or rating. It passes for a four-variant product (`kaos-polos-hitam`, `AggregateOffer`), another multi-variant one and a single-variant one (`kacang-mete-panggang-250g`, `Offer` with `sku`).

## Sitemap and robots.txt (artikel 11)

### `/sitemap.xml` (`app/sitemap.ts`)

The sitemap lists **exactly the URLs artikel 10 lets search engines index**, so a crawler finds every product without following links and never spends a visit on a `noindex` page:

- the catalog root `/`;
- each category's list, with the canonical path `catalogPageMeta` gives it (`/?kategori=<slug>`): the same function decides what is indexed and what is listed, so the two cannot drift apart. No sort orders, no searches;
- every active product, `/produk/<slug>`, from `GET /v1/products` page by page (`listProductsForSitemap` in `features/catalog/api/server.ts`): 100 per request (the API's maximum `limit`), following `next_cursor` until it is `null`, stopping if the API ever repeated a cursor.

Every URL is absolute, on `SITE_URL` (`siteUrl()`), never the request's host.

- **`lastModified` from `updated_at`, products only.** The API's public `Product` carries `updated_at`, the last time an admin saved the product (fields, variants or status), and each product's `<lastmod>` is that date. Never `created_at`: it would say that a product repriced yesterday last changed a year ago, and Google stops trusting a site's `lastmod` once it finds it wrong. A sale (stock is not an edit) and a new photo do not move it. The catalog pages get no `lastmod`, because no single date says when a list last changed. No `changeFrequency` or `priority` either: Google ignores both.
- **Rendered per request, the data cached for an hour.** `export const dynamic = "force-dynamic"`: a sitemap prerendered by `next build` would need the API during the image build and would freeze `SITE_URL` at build time. The walk through the catalog goes through the data cache for an hour (`SITEMAP_REVALIDATE_SECONDS`, tags `products` and `sitemap`), the categories for five minutes: `/sitemap.xml` is public, and a walk costs one API request per hundred products, so it is paid at most once an hour however often anyone fetches it. An hour suits a crawler, which reads a sitemap every few hours at most; a new product is also linked from the catalog's first page at once. Measured: five fetches in a row sent no request to the API; a fetch takes 10 ms.
- **A failure is a 500**, not an empty sitemap: an empty one would tell the crawler the shop has no pages; a 500 makes it try again later.

**The 50 000-URL limit.** One sitemap file may list at most 50 000 URLs and weigh 50 MB uncompressed. `listProductsForSitemap` stops at 49 000 products (the root and the categories take the rest) and logs a warning. Past that, the sitemap must be split: Next.js' `generateSitemaps()` serves `/sitemap/0.xml`, `/sitemap/1.xml`… and a sitemap index. With cursor pagination a file cannot jump to "products 49 000–97 999" without walking the ones before it, so the split would want either an API listing by a stable key range (for example by `created_at` month, or `GET /v1/products/slugs?after=…`) or a sitemap per category. The example catalog has 28 products; the guard exists so a growing shop fails loudly, not silently.

### `/robots.txt` (`app/robots.ts`)

```text
User-Agent: *
Allow: /
Disallow: /keranjang
Disallow: /checkout
Disallow: /pembayaran
Disallow: /pesanan
Disallow: /akun
Disallow: /masuk
Disallow: /daftar
Disallow: /*?q=
Disallow: /*&q=

Sitemap: https://<SITE_URL>/sitemap.xml
```

robots.txt controls **crawling**, not indexing: keeping a page out of results is `noindex` (artikel 10), which a crawler only reads on a page it may fetch.

- **Private pages** (cart, checkout, payment, orders, account, login, register) are disallowed: they are personal, render only in the browser (a crawler gets "Memuat GoShop…"), and carry `noindex` anyway; not crawling them keeps the crawl for products.
- **Search results** (`q`, written as `?q=` or, after a category, `&q=`) are disallowed: every typed word is a new URL, an endless space of thin pages, and Google's guidelines ask sites to keep internal search out of the crawl with robots.txt. Their `noindex` stays as the second line of defence.
- **Sorted lists and unknown categories stay crawlable**: a sorted list must be fetched for its canonical link to the unsorted list to be read, an unknown category for its `noindex` to be seen.
- Rendered per request too (`force-dynamic`), so the `Sitemap:` line follows `SITE_URL` at run time.

### Checked (`next start`, `SITE_URL=http://localhost:34173`)

A scratch script fetched `/sitemap.xml` and every URL in it: **42 URLs** (the root, 13 categories, 28 products), no duplicates, each answering 200 with a canonical link equal to itself and no `noindex`; the list equals the root plus every category and every product the API returns; robots.txt blocks none of them, blocks `/?q=kaos`, `/?kategori=kaos&q=polos`, `/checkout`, `/pesanan/…/pembayaran`, `/masuk?kembali=…` and `/keranjang`, and leaves `/?kategori=kaos&urut=termurah`, `/?kategori=tidak-ada` and the product pages crawlable. The paging loop ran one page here (28 products); a test with a fake API covers several pages and a repeated cursor.

## Product photos and Core Web Vitals (artikel 12)

The API has sent `images` with every product since Bab 6; Bab 8–10 drew the "Belum ada foto" placeholder instead. From artikel 12 the catalog card and the product page show the first ready photo; a product without one keeps the placeholder. The cart and the orders have no photo: the contract's `CartLine` and order lines carry none.

### Core Web Vitals, and what a photo does to each

| Metric | What it measures | Good | What the photos change |
|---|---|---|---|
| **LCP**, Largest Contentful Paint | when the largest element in the first screen is drawn | ≤ 2.5 s | the product page's photo becomes its largest element, so the page is as fast as that file |
| **CLS**, Cumulative Layout Shift | how far visible content jumps while the page loads | ≤ 0.1 | an `<img>` without a size is 0 px tall until its file arrives, then pushes everything below it down |
| **INP**, Interaction to Next Paint | how long a click or key waits for the next frame | ≤ 200 ms | nothing directly; a JPEG decoded on the main thread could delay one, so decoding is async |

Google reads them from real Chrome users (the Chrome UX Report, at the 75th percentile) as one of its page-experience signals; Lighthouse and the `PerformanceObserver` below measure them in a lab.

### A plain `<img>` with the API's variants, not `next/image`

The worker already resizes every photo to 400 and 800 pixel wide JPEGs (quality 82, ADR 0007) and the storage serves them with `Cache-Control: public, max-age=31536000, immutable`. `next/image`'s optimiser would download them again through the storefront's server, resize them a second time with sharp, and keep a second cache in every container: CPU and disk spent on work already done. A custom `next/image` loader could only map a width to a file by guessing the storage's key layout, where `variants` is the contract. WebP or AVIF, the one thing `next/image` would add, belongs in the worker (ADR 0007 records why it writes JPEG for now).

What the browser gets is what `next/image` would give it:

- **`srcset` + `sizes`.** `srcset` lists the variants with their widths (`…/400.jpg 400w, …/800.jpg 800w`); `sizes` says how wide the image is drawn per layout, so the browser can choose **before any CSS has loaded**. It takes the smallest variant at least as wide as that width times the screen's pixel density. A card on a 412 px phone at 2× is about 141 px wide, so 282 device pixels: the 400 (16 KB instead of the 800's 75 KB). The product page's photo on the same phone is about 346 px, so 692: the 800. `CARD_IMAGE_SIZES` follows the grid (2 columns, 3 from `sm`, 3 beside the category sidebar from `md`, 4 from `lg`, at most 11rem once the page stops growing); approximate is enough.
- **`width` and `height` from the API.** The browser reserves the box from their ratio before the file arrives, so nothing below it moves (CLS). The square frame is still CSS (`aspect-square`, `object-cover`).
- **`alt`**: the photo's own, or the product's name when it is empty (the contract's rule).
- **`decoding="async"`**: decoding the JPEG does not hold up the main thread.

### Which photo loads when (`ImageLoading`)

| Value | Attributes | Used for | Why |
|---|---|---|---|
| `lazy` | `loading="lazy"` | catalog cards from the fifth on | fetched only as they near the screen: a visitor who never scrolls never pays for them |
| `eager` | `loading="eager"` | the first four cards of a grid (one row at its widest) | on screen at once; lazy-loading them would only start them late |
| `priority` | `loading="eager"`, `fetchpriority="high"` | the product page's photo | its LCP element: the browser requests it ahead of the scripts it would otherwise fetch first |

Only one image per page gets `priority`: marking several high tells the browser nothing. Chrome's lazy-load margin is generous (about 1250–2500 px), so on a short catalog page every card loads anyway; the saving shows on a long list.

### The image origin in the CSP

Photos come from the image storage, another origin, so `img-src` must allow it, and only it: `img-src 'self' data: <IMAGE_ORIGIN>`, never `https:` (any host). `imageOrigin()` reads `IMAGE_ORIGIN` when the server starts and keeps only its origin (`new URL(value).origin`; a value that is not a URL fails loudly). It is the host in the API's image URLs: `S3_PUBLIC_URL` (a CDN or the bucket's public URL) in production, `S3_PRESIGN_ENDPOINT` (`http://localhost:8333`) with `make up`. Unset, development falls back to `http://localhost:8333`, and production allows no image origin at all: the photos are blocked with a CSP report in the console until it is set, rather than allowed from anywhere.

### Checked (`next start` against the `goshop-b11` stack, `IMAGE_ORIGIN=http://localhost:33333`)

- The HTML carries each `<img>` with `srcSet`, `sizes`, `width="800" height="800"`, the alt text; the first four cards `loading="eager"`, the fifth on `loading="lazy"`, the product photo `fetchPriority="high"`. The CSP header reads `img-src 'self' data: http://localhost:33333`. No CSP violation in the console.
- **Phone, 412×915 at 2×, fresh browser profile:** the catalog requested twelve `400.jpg` and no `800.jpg`; the product page requested one `800.jpg`. In a profile that had opened the product page first, the catalog card of that product showed the cached `800.jpg`: Chrome may reuse a larger candidate it already has rather than download a smaller one.
- **LCP and CLS** (a `PerformanceObserver` on `largest-contentful-paint` and `layout-shift`, local network): the product page's LCP element is the photo, at 0.49 s on the phone and 0.09 s on a 1366×900 desktop; the catalog's is the first card's photo (0.10 s). CLS is 0 to 0.004 on every page measured, far under 0.1.

## Analytics and e-commerce events (artikel 13)

GoShop can send Google Analytics 4 the e-commerce events GA4 builds its funnel and item reports from. It is **opt-in**: without `GA_MEASUREMENT_ID` the storefront loads no Google script, shows no banner and keeps the CSP of artikel 12, and `track` only logs each event with `console.debug` in development (`next dev`), so the events can be read without a GA4 property.

### The measurement ID

`analyticsId()` (`lib/server-config.ts`) reads `GA_MEASUREMENT_ID` when a page renders, like `SITE_URL`: a runtime, server-only variable, not `NEXT_PUBLIC_*`, so one image runs with or without analytics, or against another property, without a rebuild. The ID is not a secret (every visitor's browser sees it), but it is printed into an inline script, so it must look like `G-` followed by letters or digits; any other value (a Universal Analytics `UA-…`, a typo) throws, and every page answers 500 with the reason in the log, instead of being written into the page.

### The events

The contract lives in `packages/shared` (`src/analytics/ecommerce.ts`), so the mobile app (Bab 17) sends the same names and parameters: `EcommerceEvent` is a union discriminated by `name`, and a builder makes each event from the API's own types. Every amount is whole rupiah as the API sends it (`currency: "IDR"`, integers, never a formatted string). An item's `item_name` is the product's name in every event, so GA4 can follow one product from the list to the purchase; `item_id` is the variant's SKU and appears only once a variant is known (cart, checkout, order).

| Event | When | Where | Key parameters |
|---|---|---|---|
| `view_item_list` | the first page of a list is on screen, once per set of filters (the later pages are not new lists) | `features/catalog/components/CatalogPage.tsx` (`useTrackOnce`, keyed by the filters) | `item_list_id`/`item_list_name`: `katalog`/`Katalog`, the category's slug/name, or `pencarian`/`Hasil pencarian` (the search text is not sent); `items` with `index`, `price` = `price_from` |
| `view_item` | a product page shows its product, once per product | `features/product/components/ProductDetailPage.tsx` (`useTrackOnce`, keyed by the product's id) | `value` = `price_from`, one item without `item_id` |
| `add_to_cart` | the API **accepted** the add (`onSuccess`), never the optimistic guess | `features/cart/hooks/useAddToCart.ts` | the line from the API's answer (its SKU and price), `quantity` = what this add added, `value` = price × quantity |
| `remove_from_cart` | the API **confirmed** a line's removal; lowering a quantity is not one | `features/cart/hooks/useChangeCartLine.ts` (the line is captured at the click, in `removed`) | the whole line |
| `begin_checkout` | the checkout page knows the cart's lines, once per visit | `features/checkout/components/CheckoutPage.tsx` (`useTrackOnce`) | `value` = the cart's subtotal, the lines |
| `add_shipping_info` | the buyer picks a courier service (each new pick) | `onSelect` of `CourierStep` in `CheckoutPage.tsx` | `shipping_tier` = courier and service codes (`JNE REG`), `coupon` if a voucher is applied, the lines |
| `add_payment_info` | `POST /v1/orders/{id}/pay` was accepted, just before the buyer leaves for Midtrans (or the fake gateway's page) | the mutation's `onSuccess` in `features/orders/hooks/usePayOrder.ts` (from checkout, the payment page and the order page) | `value` = the order's total, the order's lines, `coupon`, `payment_type` = `midtrans_snap` or `fake_gateway` (the method is chosen on Midtrans' page; the storefront never learns it) |
| `purchase` | the payment page sees the order paid (the API's word: the webhook or the reconciler, never Midtrans' return URL), once per order | `features/orders/components/PaymentPage.tsx` → `trackPurchaseOnce` (`features/analytics/purchase.ts`) | `transaction_id` = the order's code, `value` = its total, `shipping` = its shipping fee, `coupon` = its voucher code, `items` = the order's own lines (the prices it was sold at) |

**Fired once, at the moment the fact is known.** A view is sent from an effect, not from the render (a component renders again for every poll and state change, and twice in development); `useTrackOnce` keeps the last key it sent in a ref, so a background refetch is not a second view, and Strict Mode's extra mount sends nothing twice. A write is sent from the mutation's own `onSuccess`, which runs even when the component that started it has unmounted. **Page views** are not sent by the storefront: `config` sends the first, and GA4's enhanced measurement ("page changes based on browser history events", on by default in a web stream) counts each client-side navigation.

**Never personal data.** Google's terms forbid sending anything that identifies a person, and a GA4 property is read by more people than the order database. The events carry catalog data (product and variant names, SKUs, categories, prices) and an order's code; never an email, a name, a phone number, an address, a user id or a token. The types are closed, and no builder takes a user or an address, so adding one is a visible change to the contract, not a stray field. The catalog's search text is left out too: it is whatever the buyer typed.

### `track`

`track(event)` (`lib/analytics.ts`) does nothing on the server, never throws (analytics is the one feature a buyer did not ask for; a bug in it must not break "Tambah ke keranjang"), logs the event in development, and calls `gtag('event', name, params)` when `gtag` exists. `gtag` is defined by the inline script below before React hydrates, as a queue (`dataLayer`): an event sent while gtag.js is still downloading waits there and is sent, in order, when it arrives.

### Loading Google's tag, under the CSP

| Script | How | Why |
|---|---|---|
| the init script: `dataLayer`, `gtag()`, Consent Mode's default, `js`, `config` | a plain inline `<script>` in `<head>` (`gtagInitScript`, `features/analytics/gtag-init.ts`), with the request's nonce | it runs while the HTML is parsed, before React hydrates and before the page's first events (`view_item_list` and `view_item` fire at hydration); `next/script`'s `afterInteractive` would run it after them |
| gtag.js (`https://www.googletagmanager.com/gtag/js?id=…`) | `next/script`, `strategy="afterInteractive"`, `nonce` | a large script nobody needs to wait for; the queue holds every call until it runs |

Both carry the nonce of artikel 08, so `script-src` gains a host, never `'unsafe-inline'`. When the ID is set, `proxy.ts` adds the hosts Google documents for GA4 (developers.google.com/tag-platform/security/guides/csp), and nothing else changes:

- `script-src` + `https://*.googletagmanager.com`
- `img-src` + `https://*.google-analytics.com https://*.googletagmanager.com`
- `connect-src` + `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`

Not `@next/third-parties`' `<GoogleAnalytics>`: it sends `config` from its own script after hydration, so Consent Mode's default (which must come first) and the hydration-time events would need a second script anyway, and it adds a dependency.

### Consent Mode v2, with a banner

1. **Default, before `config`:** `ad_storage`, `ad_user_data` and `ad_personalization` are always `denied` (GoShop runs no ads, and no event of ours should reach an advertising product); `analytics_storage` is the buyer's stored answer, or `denied`. The init script reads the answer from `localStorage` itself, synchronously, so a buyer who said "Izinkan" yesterday is counted with a cookie from the first hit, not after an update.
2. **The banner** (`features/analytics/components/AnalyticsConsent.tsx`) appears only when GA is configured and no answer is stored: "Izinkan analytics?", what is collected (and what is not), "Izinkan" and "Tolak". An answer is applied at once with `gtag('consent', 'update', { analytics_storage })` and stored in `localStorage` under `goshop:analytics-consent` (`granted` or `denied`, every access in `try`/`catch`: blocked storage means the banner asks again next visit). Another tab's answer reaches this tab through the `storage` event and is applied here too.
3. **Changing it later:** "Pengaturan analytics" in the footer (the footer exists only when analytics is on) opens the banner again with the current answer; `Esc` or "Tutup" closes it.

**Accessible, and out of the way.** The banner is a `<section>` named by its heading (a region in the landmarks list), with real buttons. It does not take the focus when it appears by itself: a buyer typing an address is not interrupted, and may answer later or never (no answer is `denied`). Opened from the footer button it takes the focus, because the buyer asked for it, and gives it back to that button when it closes. It is fixed to the bottom of the screen (a small card in the corner from `md`), and a spacer of its measured height sits under the page, so the last thing on a page, such as checkout's pay button on a phone, can always be scrolled above it. Fixed rather than inserted into the page: a banner pushed in after hydration would move everything below it, a layout shift (CLS, artikel 12). It is not in the server's HTML: the stored answer is only known in the browser (`useSyncExternalStore` with a server snapshot of "not known yet").

**Advanced, not basic, consent mode.** In **basic** mode nothing of Google's loads until the buyer says yes: the stricter choice, with no request to Google at all before consent, and the one to use if a legal review asks for it (render the scripts only once `goshop:analytics-consent` is `granted`). GoShop uses **advanced** mode: gtag.js loads for everyone, and before consent (or after "Tolak") it writes no cookie and sends **cookieless pings** (no client id), which GA4 only uses for modelled totals. The shop still learns roughly how many people reach checkout and buy, without identifying anyone, and the banner can stay non-modal. The banner's text says so: "Bila ditolak, tidak ada cookie analytics; Google hanya menerima hitungan tanpa cookie."

### `purchase`: once per order, and its limit

The payment page sees "paid" whenever it is opened for a paid order: a reload, Back from Midtrans, a link from the order history. GA4's own de-duplication by `transaction_id` is limited and not something a report should rest on, so `trackPurchaseOnce` keeps the codes already sent in `localStorage` (`goshop:analytics-purchases`, the last 20) and sends nothing for a code it holds. Blocked storage falls back to the page's memory: a reload might send it again, the lesser harm than never sending it. Without `GA_MEASUREMENT_ID` nothing is stored.

**The known gap:** the purchase is counted only if the buyer comes back to the payment page. A buyer who pays at Midtrans and closes the tab, or whose order is paid on another device, is never counted in this browser (and one who opens a paid order's payment page on a second device is counted there again). The reliable fix is **server-side**: when the payment webhook marks an order paid, the API sends `purchase` with GA4's **Measurement Protocol** (`POST https://www.google-analytics.com/mp/collect` with the measurement ID and an API secret), once, in the same place the order changes; the browser's event would then be dropped or kept only for the client id. Not built in GoShop; a candidate for a later challenge.

`add_payment_info` is sent just before the browser leaves for Midtrans; delivering a hit queued that late is gtag.js' business (it flushes queued hits when the page is hidden), not verified here against a real property.

### Checked

Against the `goshop-b11` stack, `next start` on port 33175 (`API_INTERNAL_URL=http://localhost:33080`, `SITE_URL=http://localhost:33175`, `IMAGE_ORIGIN=http://localhost:33333`), a production build; browser checks with Playwright's Chromium on a phone profile (412×915), Google's collection hits aborted by the test so nothing reached a property.

- **Without `GA_MEASUREMENT_ID`:** the CSP header is artikel 12's exactly (no Google host); the HTML has no `googletagmanager`; in the browser there is no `window.gtag` or `dataLayer`, no banner, no footer, no request to a Google host, no CSP violation, and no `goshop:analytics-*` key in `localStorage`.
- **With `GA_MEASUREMENT_ID=G-TEST123456`:** the CSP header carries the hosts above; the HTML's `<script id="gtag-init">` carries the same nonce as the header; the gtag.js element that `next/script` adds carries that nonce too (`script.nonce` equals the init script's), and the real gtag.js loaded (`window.google_tag_manager` exists).
- **Consent:** on a first visit `dataLayer` starts with `consent default` (all four `denied`), before `js` and `config`; the banner is visible and the focus stays on `<body>`. "Izinkan" pushes `consent update` with `analytics_storage: granted`, stores `granted`, and hides the banner; after a reload the *default* is `granted` and there is no banner. "Pengaturan analytics" reopens it with the focus on it and "Pilihan Anda sekarang: diizinkan"; "Tolak" pushes `update` `denied` and returns the focus to the button; after a reload the default is `denied`, no banner. Scrolled to the end of the catalog on the phone profile, the bottom of `<main>` (666 px) is above the banner's top (726 px; the banner is 189 px tall).
- **Events in `dataLayer`:** `view_item_list` once on `/` (`katalog`, 12 items with `index`, `price` = `price_from`); `view_item` once on a product page, and once more after a client-side navigation to another product. `add_to_cart` and `remove_from_cart` were exercised as a guest with the test answering the browser's CORS checks (this stack's API only allows another origin) and forwarding the requests to the API: no `add_to_cart` before the click, one after "Ditambahkan ke keranjang" with the API's SKU (`KPH-S`), price 89 000 and the quantity added (2); one `remove_from_cart` only after the API confirmed the removal.
- **Not exercised in a browser:** `begin_checkout`, `add_shipping_info`, `add_payment_info` and `purchase` (checkout needs a buyer with a verified email, which this stack has none of) and `trackPurchaseOnce`'s storage; their builders were run with Node on a sample cart and order (values, `shipping_tier: "JNE REG"`, `coupon`, `transaction_id`, `shipping`), and the call sites type-check.
- **Seen, and left as decided:** with the test ID, gtag.js also tried `https://www.google.com/g/collect` (with and without consent), which the CSP refuses (a console error per hit). Google's CSP guide lists `*.google.com` only for Google Signals; the hits to `www.google-analytics.com/g/collect` are allowed.
- A malformed `GA_MEASUREMENT_ID` (`UA-12345-1`) makes `/` answer 500 with "GA_MEASUREMENT_ID is not a GA4 measurement ID" in the log.

## Deploying the storefront (artikel 14)

Until artikel 08 the storefront was static files: Vite built `dist/`, Caddy served it. From artikel 08 it is a **server**: every page renders per request (the CSP nonce), product pages read the API, `/sitemap.xml` walks the catalog. A static host cannot run it any more; it needs a Node.js process. `apps/web/Caddyfile` is deleted: its headers moved to `next.config.ts` and `src/proxy.ts` in artikel 08.

### The image (`apps/web/Dockerfile`)

- **Build stage**, from the repository root as context (as Railway builds it): `pnpm fetch` from the lockfile alone (a layer reused until the lockfile changes), then the workspace's `packages/` and `apps/web/`, `pnpm install --offline` for `@goshop/web` and what it depends on, and `next build`. `NEXT_PUBLIC_API_URL` is a **build argument**, required: Next.js writes it into the browser's JavaScript, so it cannot change at run time.
- **`output: "standalone"`** makes `next build` write `.next/standalone/`: `apps/web/server.js` and only the `node_modules` files the server imports, traced from the workspace root (`outputFileTracingRoot`), so `packages/shared` is in it too. Next.js leaves two folders out on purpose, because a CDN usually serves them: `.next/static` (the hashed browser files) and `public/`. The Dockerfile copies both next to `server.js`, so this one container serves everything.
- **Run stage**: the same `node:24.22.1-alpine`, nothing installed, the traced files only (image 207 MB, most of it Node.js itself). It runs as the image's `node` user (uid 1000), which owns none of the files: the server only reads them. `PORT` defaults to 8080 (Railway sets its own); `HOSTNAME=0.0.0.0`, because `server.js` binds to `HOSTNAME` and Docker sets that variable to the container's id, an address the health check on 127.0.0.1 cannot reach. `HEALTHCHECK` asks `GET /healthz`, which touches neither the API nor a file.
- **Run-time settings**, read by the server when it starts, so one image serves any environment its build argument fits: `API_INTERNAL_URL`, `SITE_URL` (required in production), `IMAGE_ORIGIN`, `GA_MEASUREMENT_ID` (`apps/web/README.md`, Configuration).

### Docker Compose (`make up`)

The `web` service builds the image with `NEXT_PUBLIC_API_URL=http://localhost:8080` (the API as the *host's* browser reaches it) and runs it with `API_INTERNAL_URL=http://api:8080` (the API as the *container* reaches it, by service name), `SITE_URL=http://localhost:5173`, `IMAGE_ORIGIN=http://localhost:8333` (the storage as the browser reaches it, the API's `S3_PRESIGN_ENDPOINT`) and an empty `GA_MEASUREMENT_ID` unless the host's environment sets one. It starts after the API is healthy: its pages are the API's data. Published on 5173, the origin the API's CORS default allows.

### Railway (`deploy/railway/web.json`)

Railway builds `apps/web/Dockerfile` from the repository root, rebuilds when the storefront, `packages/` or the lockfile change (`watchPatterns`), and waits for `/healthz` before switching traffic. The service's variables, set in Railway's dashboard:

| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | the API service's public URL, `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Railway passes a service variable whose name matches a Dockerfile `ARG` to the build; changing it means a new build |
| `API_INTERNAL_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`, with `PORT` set explicitly on the API service (for example 8080) so the reference resolves | server-to-API calls stay on Railway's private network, without TLS or the public edge |
| `SITE_URL` | the storefront's public URL (its custom domain, or `https://${{RAILWAY_PUBLIC_DOMAIN}}`) | canonical links, Open Graph, the sitemap; without it production answers 500 |
| `IMAGE_ORIGIN` | the origin of the API's `S3_PUBLIC_URL` (the bucket's public URL or its CDN) | the CSP's `img-src`; without it no photo loads |
| `GA_MEASUREMENT_ID` | the GA4 property's ID, or unset | analytics, opt-in |

The API's `APP_CORS_ALLOWED_ORIGINS` must include `SITE_URL`'s origin, and its `APP_WEB_URL` (where Midtrans returns the buyer, Bab 11 artikel 04) must be the same address. TLS ends at Railway's edge; the container speaks plain HTTP, so `Strict-Transport-Security` belongs to the edge or the custom domain's settings, as it did with Caddy.

### Vercel, compared

Vercel builds Next.js without a Dockerfile: it reads the framework, runs each page as a serverless function and puts `.next/static` and `public/` on its CDN. For this storefront:

- **What carries over**: the code. `proxy.ts` runs as Vercel's routing middleware, the data cache and `revalidate` work through Vercel's own cache, and the environment variables are the same (set per environment: Production, Preview, Development).
- **What changes**: the monorepo needs the project's Root Directory set to `apps/web` (Vercel installs the pnpm workspace from the root by itself); `output: "standalone"` is ignored there; the API and the worker cannot run on Vercel (a long-running Go process, a queue worker), so they stay on Railway, and `API_INTERNAL_URL` becomes the API's public URL, since there is no private network between the two; every function's cold start reaches the API over the internet.
- **Why GoShop deploys the container**: every GoShop service already runs on Railway from a Dockerfile, so one platform, one private network and one log view cover the API, the worker and the storefront, and the same image runs under `make up`. Vercel would buy a CDN in front of the static files and preview deployments per pull request; both are worth it for a team shipping the storefront often, and the code needs no change to move.

### Checked (`docker build` on colima, the container on the `goshop-b11` network)

- `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:33080 .`: 2 min 19 s from a warm pnpm store, image 207 MB.
- Run with `API_INTERNAL_URL=http://api:8080`, `SITE_URL=http://localhost:33177`, `IMAGE_ORIGIN=http://localhost:33333`, published on 33177: `healthy` within seconds; the process is `uid=1000(node)`; `/`, a product page (its `<h1>` and canonical link from the API, through the internal URL), `/sitemap.xml` (42 URLs), `/robots.txt`, `/keranjang`, `/healthz` and `/theme.js` answer 200, an unknown path 404; a `/_next/static/…` file has `Cache-Control: public, max-age=31536000, immutable`; the CSP and the other headers are present, `X-Powered-By` is not.
- In Chromium: the catalog hydrated, a click on a product navigated on the client, its photo loaded, and the console had no error apart from the API's CORS refusal of this ad-hoc origin.
- `docker stop` took 0.3 s: Node.js, as PID 1, ends on `SIGTERM` (exit code 143) instead of waiting 10 s to be killed.

## Bab 11 recap (artikel 15)

- **A buyer can finish:** the full cart page with optimistic quantities and one queue for every write (artikel 01); address and courier as page state with everything else derived (02); a summary whose every rupiah comes from the API's preview, and vouchers applied by asking it first (03); one press that places the order with an Idempotency-Key and starts Midtrans Snap by redirect, keeping Midtrans' code off our origin (04); a payment page that polls with backoff, stops on a final status, and believes only the API (05); the order history and each order's own snapshot (06).
- **Crawlers can read it:** measured what a crawler gets from the single-page app (07); moved to the Next.js App Router with server and client components and a nonce-based CSP (08); product and catalog pages rendered on the server from the API through the data cache, ISR applied to the data (09); metadata, Open Graph and `Product` structured data from `SITE_URL` (10); a sitemap and robots.txt that list exactly what may be indexed (11).
- **Fast, measured, deployed:** product photos with `srcset` from the API's variants, reserved boxes, the LCP photo first, and one image origin in the CSP (12); GA4 e-commerce events from one contract in `packages/shared`, behind Consent Mode and a banner, with no personal data (13); the standalone Next.js server in a non-root container, on Compose and Railway, with Vercel compared (14).

What Bab 11 leaves open on purpose: the unit and end-to-end tests catch up with the App Router in the chapter's test stages (`docs/bab-11.md`); a purchase is counted only when the buyer sees the payment page (the server-side fix is in artikel 13); the admin who will change prices, and so the reason to drop cached data on demand, arrives in Bab 12.

### The Bab 10 challenge, after the move

The mini cart drawer is still a challenge with no solution in the code, and two of its steps read differently now. The four questions about where state lives are in `components/layout/Providers.tsx` (`app/App.tsx` is gone). And the CSP's `style-src` is `'self'` plus this request's nonce (`src/proxy.ts`): the `<style>` element `react-remove-scroll` inserts carries no nonce, so a modal Radix dialog is still refused, and the constraint stands: no `'unsafe-inline'`.

## Challenge: a promo page with ISR

GoShop wants campaign pages, such as `/promo/kopi-nusantara`: a banner text, the voucher to use, and the products of one category, found by search engines and shared on WhatsApp. The API has no promotions endpoint, so the campaigns live in the storefront as data. Build it; there is no solution in the code, and each step names the article it leans on.

1. **Campaigns as data** (artikel 03, 09). A file such as `features/promo/campaigns.ts` exports a list: `slug`, `title`, `description`, `voucherCode`, `categorySlug`, `startsAt`, `endsAt`. Type it, and parse it once with a Zod schema (as `packages/shared/src/schemas/` does for forms) where the file is loaded, so a typo in a date fails loudly instead of showing a wrong page.
2. **The route** (artikel 08–09). `app/promo/[slug]/page.tsx`, a server component: find the campaign, `notFound()` for an unknown slug, fetch the category's products through `serverApi` with `revalidate` and the tags artikel 09 uses, and render the grid with the existing `ProductGrid`, the first row's photos eager (artikel 12). A campaign before `startsAt` is a 404; after `endsAt` the page stays (people still have the link) but says "Promo sudah berakhir" and hides the voucher.
3. **The ISR question** (artikel 08–09). Try `export const revalidate = 300` on the page and `generateStaticParams` for the campaigns, then run `next build` and read its route table: the page is still `ƒ (Dynamic)`. Find out why (the root layout reads `headers()` for the CSP nonce) and write down what whole-page ISR would cost here: a page HTML cached once carries one nonce for every visitor. Then make the data the cached part, as artikel 09 does, and explain in a comment why that is ISR in the sense that matters for this page.
4. **On-demand revalidation** (artikel 09, 14). Add `app/api/revalidate/route.ts`: a `POST` that takes a tag, checks a `REVALIDATE_SECRET` sent in a header (compared in constant time, never logged), and calls `revalidateTag`. Answer 401 without the secret, 400 for an unknown tag. Add the variable to `apps/web/.env.example`, the Compose `web` service and the Railway table. Who would call it? Write down the answer Bab 12's admin will need.
5. **Search engines and link previews** (artikel 10–11). `generateMetadata` with the campaign's title and description, a canonical URL on `SITE_URL`, an Open Graph image (the first product's photo); list active campaigns in `app/sitemap.ts`, with no `lastModified` you cannot back with data; an ended campaign gets `noindex`.
6. **Analytics** (artikel 13). GA4 has `view_promotion` and `select_promotion`; add them to the event contract in `packages/shared` (with `promotion_id` and `promotion_name`, still no personal data) and fire `view_promotion` once per page view, `select_promotion` when a product card on the page is opened.
7. **Check it like the rest:** the page answers 200 with the products in the HTML before any JavaScript runs (artikel 07's `seo-probe.js`), a second request within `revalidate` sends no request to the API (watch its log), the revalidate route drops the cache (the next request does reach the API), no CSP violation in the console, and the Lighthouse LCP element is a product photo, not the banner text, or explain why not.

## Bab 11, articles 01–06: what changed in the storefront

- New routes, all lazy and behind `RequireAuth` except the cart: `/checkout`, `/pesanan`, `/pesanan/:id`, `/pesanan/:id/pembayaran`, `/pembayaran/selesai`.
- New shared code in `packages/shared` (for the web now and the mobile app from Bab 13): `updateCartItem`, `removeCartItem`, `listAddresses`, `createAddress`, `getShippingQuotes`, `previewCheckout`, `checkoutProblems`, `placeOrder`, `payOrder`, `getOrder`, `listOrders`; `addressSchema` and `voucherSchema`; the contract's types for addresses, quotes, the preview, orders and payment sessions.
- The CSP and every other header in `apps/web/Caddyfile` are unchanged (artikel 04 explains why the payment needs nothing there).
- Still to come in Bab 11: the move to the Next.js App Router, server rendering and SEO for product pages (artikel 07 onwards), and real product photos (`docs/bab-8.md`, Deferred).
