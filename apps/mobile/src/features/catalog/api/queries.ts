// The catalog's TanStack Query options: query keys and the infinite list,
// shaped like apps/web/src/features/catalog/api/queries.ts so the two
// apps' caches read the same way. The request itself is fetchProductPage
// (./products.ts); this file only says how TanStack Query pages through it.
import { infiniteQueryOptions } from "@tanstack/react-query";
import { fetchProductPage } from "./products";
import type { ProductListFilters } from "./products";

/**
 * The catalog's query keys, in one place. A key is an array, like a path:
 * compared by value, and a prefix matches every longer key, so
 * invalidating ["products"] reaches every product list at once.
 *
 *   ["categories"]
 *   ["products"]
 *   ["products", "list", { category, q, sort }]
 */
export const catalogKeys = {
  categories: ["categories"] as const,
  products: ["products"] as const,
  productLists: () => [...catalogKeys.products, "list"] as const,
  productList: (filters: ProductListFilters) =>
    [...catalogKeys.productLists(), filters] as const,
};

/**
 * GET /v1/products, page by page.
 *
 * An infinite query is one cache entry holding a list of pages. The first
 * page is fetched with `initialPageParam` (null: no cursor), each next one
 * with what getNextPageParam returns from the page before, here its
 * `next_cursor`; undefined means there is no next page (hasNextPage false).
 *
 * The filters are part of the key: each search and sort is its own list,
 * and a cursor, valid only with the filters it came from, never crosses
 * from one to another. TanStack Query passes a `signal`, so a request for
 * a list nobody shows any more (the search changed) is aborted.
 */
export const productListQuery = (filters: ProductListFilters) =>
  infiniteQueryOptions({
    queryKey: catalogKeys.productList(filters),
    queryFn: ({ pageParam, signal }) =>
      fetchProductPage(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const next = lastPage.page.next_cursor;
      // A next cursor equal to the one just used would ask for the same
      // page forever: treat it as the end, as the web does.
      return next === null || next === lastPageParam ? undefined : next;
    },
  });
