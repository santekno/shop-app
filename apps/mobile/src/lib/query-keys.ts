// Every TanStack Query key of the app, in one place. A key is an array
// compared by value, and a prefix matches every longer key: invalidating
// ["products"] reaches the catalog lists, the featured row and every
// product detail at once, while ["products", "list"] reaches only the
// lists. Writing keys by hand at each call site is how two screens end up
// caching the same data twice, or one forgets to refresh with the other.
//
// A factory, not constants: a key with a parameter is a function of it, so
// the parameter cannot be forgotten and its position cannot differ between
// two screens. `as const` keeps each key a tuple, which queryOptions carries
// on to the data type.
import type { ListProductsQuery } from "@goshop/shared";

/** What narrows the catalog list: everything of the query but the cursor. */
export type ProductListKeyFilters = Omit<ListProductsQuery, "cursor">;

/**
 * The key tree:
 *
 *   ["categories"]
 *   ["banners"]
 *   ["products"]
 *   ["products", "list", { category, q, sort }]   one catalog list
 *   ["products", "featured"]                      Beranda's featured row
 *   ["products", "detail", slug]                  one product page
 *   ["wishlist", "ids"]                           the saved slugs (hearts)
 *   ["wishlist", "list"]                          the wishlist screen's pages
 *
 * ["wishlist"] is the buyer's own data: it is NEVER persisted to disk
 * (shouldPersistQuery in query-persist.ts allow-lists the catalog keys
 * only, so a new scope is excluded until someone adds it there).
 */
export const queryKeys = {
  categories: ["categories"] as const,
  banners: ["banners"] as const,
  products: {
    all: ["products"] as const,
    lists: () => [...queryKeys.products.all, "list"] as const,
    list: (filters: ProductListKeyFilters) =>
      [...queryKeys.products.lists(), filters] as const,
    featured: () => [...queryKeys.products.all, "featured"] as const,
    detail: (slug: string) =>
      [...queryKeys.products.all, "detail", slug] as const,
  },
  wishlist: {
    all: ["wishlist"] as const,
    ids: () => [...queryKeys.wishlist.all, "ids"] as const,
    list: () => [...queryKeys.wishlist.all, "list"] as const,
    toggle: ["wishlist", "toggle"] as const,
  },
};
