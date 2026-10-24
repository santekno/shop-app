/** The route pattern of a product page; useParams() reads `slug` from it. */
export const PRODUCT_ROUTE = "/produk/:slug";

/**
 * The URL of a product's page. The slug is one path segment, so it is
 * encoded: a "/" or "?" in it must not change which route matches.
 * (The router decodes it again before useParams returns it.)
 */
export const productPath = (slug: string): string =>
  `/produk/${encodeURIComponent(slug)}`;

/**
 * The state a catalog card puts on its link. History entries carry it, so
 * the product page knows that the entry before it is a catalog list (with
 * its filters, its pages and its scroll position), and its "back" link can
 * return there with history.back() instead of opening a fresh "/".
 */
export const FROM_CATALOG = { fromCatalog: true } as const;

/** Whether a location's state is FROM_CATALOG. It is `unknown`: anything
 *  can be in history.state, so it is checked, not cast. */
export const cameFromCatalog = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "fromCatalog" in state &&
  state.fromCatalog === true;
