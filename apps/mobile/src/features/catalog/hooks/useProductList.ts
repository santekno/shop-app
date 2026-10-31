import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { productListQuery } from "../api/queries";
import type { ProductListFilters } from "../api/products";

/**
 * The catalog's products for some filters, page by page, from the cache:
 * the web's useProductList (apps/web/src/features/catalog/hooks) plus what
 * pull-to-refresh needs.
 *
 * `products` flattens the pages, once per change of the pages (useMemo),
 * not on every render. Unchanged products keep their identity between
 * renders (TanStack Query shares unchanged data structurally), so
 * memo(ProductCard) skips the cards already on screen when a page arrives.
 *
 * `refresh` is for pull-to-refresh: the buyer is at the top of the list
 * and asks for it again. It keeps only the first page in the cache and
 * refetches that one; the later pages are fetched fresh when the buyer
 * scrolls to them. A plain refetch() of an infinite query fetches every
 * page loaded so far again, one after the other, before anything changes
 * on screen: ten requests for a buyer who had scrolled through ten pages.
 *
 * `isRefreshing` is true only for that pull, not for the background
 * refetches TanStack Query runs by itself (back to the app, network back,
 * stale data on mount). Tied to `isRefetching`, the spinner would drop
 * from the top of the list every time the buyer returns to the app.
 *
 * @example
 *   const { products, hasNextPage, fetchNextPage, refresh } =
 *     useProductList({ sort: "newest" });
 */
export const useProductList = (filters: ProductListFilters) => {
  const queryClient = useQueryClient();
  const options = productListQuery(filters);
  const query = useInfiniteQuery(options);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      queryClient.setQueryData(options.queryKey, (data) =>
        data === undefined
          ? data
          : {
              pages: data.pages.slice(0, 1),
              pageParams: data.pageParams.slice(0, 1),
            },
      );
      // An error is in query.error; the screen shows it.
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const pages = query.data?.pages;
  const products = useMemo(
    () => pages?.flatMap((page) => page.data) ?? [],
    [pages],
  );
  // The fields the list uses, read one by one, not `...query`: TanStack
  // Query re-renders a component only for the fields it has read (tracked
  // properties), and spreading the result reads every one of them.
  return {
    data: query.data,
    products,
    status: query.status,
    fetchStatus: query.fetchStatus,
    error: query.error,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    isRefetchError: query.isRefetchError,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    refresh,
    isRefreshing,
  };
};
