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

- Start recording, click "Muat lebih banyak", then stop. With "Record why each component rendered" turned on in the settings, the cards that were already on screen show "Did not render": that is `memo(ProductCard)` together with the `useCallback` in `App`. Remove the `useCallback` and record again: every card renders, because its `onSelect` prop changed.
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
| 11 | The API's errors on the form | `lib/api-form-errors.ts` (`setApiFieldErrors`, the Indonesian wording), `onError` in `LoginPage` and `RegisterPage` (`EMAIL_TAKEN`, `INVALID_CREDENTIALS` as a `root` error), `features/auth/auth-errors.ts` |
| 12 | Error boundary and 404 | `app/RouteErrorPage.tsx` (`useRouteError`, `isRouteErrorResponse`), `ErrorBoundary` in `app/routes.tsx`, `app/NotFoundPage.tsx`, `throwOnError` in `ProductDetailPage.tsx`, `hooks/useLateHeadingFocus.ts`; `lib/report-error.ts` as `RouterProvider`'s `onError` (`app/App.tsx`), with React's `onCaughtError` left silent (`main.tsx`): each caught error is reported once, and the expected NOT_FOUND not at all |
| 13 | Lazy routes, code splitting | `lazy` in `app/routes.tsx`, `features/product/lazy.ts`, `features/auth/lazy.ts`, `app/NavigationProgress.tsx`, `app/AppLoading.tsx` (`HydrateFallback`). `pnpm --filter @goshop/web build` lists one file per lazy page plus a shared chunk with React Hook Form and Zod (Rollup names a shared chunk after one of its modules, here `navigation-state`) |
| 14 | Prefetch on hover | `features/product/hooks/usePrefetchProduct.ts` (mouse only, after 100 ms; keyboard focus; never touch), used by `ProductCard`. It calls `queryClient.query`, the newer name of `prefetchQuery`, which TanStack Query 5.10x marks deprecated |
| 15 | Recap | this section, and the challenge below |

## Accessibility notes

- After a navigation the focus moves to the new page's `<h1>` (every page has one, `tabIndex={-1}`), or back to the card of the product the buyer came from; a page whose heading arrives with its data takes it over from `<main>` (`useLateHeadingFocus`). A change of query string (a filter, the sort) leaves the focus on the control in use.
- Form errors are linked to their inputs with `aria-describedby` and mark them `aria-invalid`; the first invalid field gets the focus, whether the error came from Zod or from the API.
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
