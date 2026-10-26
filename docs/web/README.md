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
