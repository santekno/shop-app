/** The route pattern of a product page; useParams() reads `slug` from it. */
export const PRODUCT_ROUTE = "/produk/:slug";

/**
 * The URL of a product's page. The slug is one path segment, so it is
 * encoded: a "/" or "?" in it must not change which route matches.
 * (The router decodes it again before useParams returns it.)
 */
export const productPath = (slug: string): string =>
  `/produk/${encodeURIComponent(slug)}`;
