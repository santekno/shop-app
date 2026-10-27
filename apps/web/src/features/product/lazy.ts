/**
 * The product page's code, loaded on demand.
 *
 * A dynamic import() is a promise of a module. Vite (Rollup) sees it at
 * build time and puts that module, and whatever only it uses, in a file
 * of its own (a chunk), downloaded the first time the promise is created.
 * Later calls get the same promise back: the module loads once.
 *
 * One function for both callers: the route's `lazy` (routes.tsx) and the
 * prefetch on a product card (artikel 14).
 */
export const loadProductPage = () =>
  import("./components/ProductDetailPage.tsx");
