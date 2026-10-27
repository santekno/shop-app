/** Where a product page lives: app/produk/[slug]/page.tsx. */
const PRODUCT_PREFIX = "/produk/";

/**
 * The URL of a product's page. The slug is one path segment, so it is
 * encoded: a "/" or "?" in it must not change which route matches.
 * (Next.js decodes it again before the page reads `params.slug`.)
 */
export const productPath = (slug: string): string =>
  `${PRODUCT_PREFIX}${encodeURIComponent(slug)}`;

/**
 * The slug of a product page's path, decoded, or undefined for any other
 * path (useRouteFocus: the card to focus when the buyer comes back).
 */
export const productSlugFromPath = (path: string): string | undefined => {
  if (!path.startsWith(PRODUCT_PREFIX)) return undefined;
  const segment = path.slice(PRODUCT_PREFIX.length);
  if (segment === "" || segment.includes("/")) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

/**
 * What a catalog card leaves for the product page it opens
 * (lib/navigation-state.ts): the entry before the product is that list,
 * with the buyer's filters, its pages and its scroll position, so the
 * product page's "back" link can return there with history.back()
 * instead of opening a fresh "/".
 */
export const FROM_CATALOG = { fromCatalog: true } as const;

/** Whether a page's navigation state is FROM_CATALOG. It is `unknown`:
 *  anything can be in storage, so it is checked, not cast. */
export const cameFromCatalog = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  "fromCatalog" in state &&
  state.fromCatalog === true;
