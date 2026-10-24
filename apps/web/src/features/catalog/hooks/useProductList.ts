import { useInfiniteQuery } from "@tanstack/react-query";
import { productListQuery } from "../api/queries.ts";
import type { ProductListFilters } from "../api/queries.ts";

/**
 * The catalog's products for some filters, page by page, from the cache.
 *
 * Replaces Bab 8's useProducts, which kept the pages, the cursor, a phase
 * and an attempt counter in state, and started a new list by comparing
 * a key while rendering. useInfiniteQuery keeps all of that per key, and
 * keeps it after the catalog unmounts: back from a product page, every
 * page the buyer had loaded is on screen at once (and refetched in the
 * background once it is stale).
 *
 * `products` flattens the pages. The products themselves keep their
 * identity between renders (TanStack Query shares unchanged data
 * structurally), so memo(ProductCard) still skips cards already shown.
 *
 * @example
 *   const { products, hasNextPage, fetchNextPage } = useProductList({ limit: 12 });
 */
export const useProductList = (filters: ProductListFilters) => {
  const query = useInfiniteQuery(productListQuery(filters));
  const products = query.data?.pages.flatMap((page) => page.data) ?? [];
  return { ...query, products };
};
