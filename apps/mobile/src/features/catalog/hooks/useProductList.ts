import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { Product } from "@goshop/shared";
import { productListQuery } from "../api/queries";
import type { ProductListFilters } from "../api/products";

/**
 * The pages' products as one list, each product once. The API pages by
 * cursor over a list that keeps changing (a product is added, the order of
 * "newest" shifts), so a product can end one page and start the next. Two
 * rows with the same key make FlashList recycle the wrong cell, and React
 * warns about duplicate keys; the first occurrence wins, so a row never
 * jumps backwards.
 */
export const flattenPages = (
  pages: readonly { data: readonly Product[] }[] | undefined,
): Product[] => {
  const seen = new Set<string>();
  const products: Product[] = [];
  for (const page of pages ?? []) {
    for (const product of page.data) {
      if (!seen.has(product.id)) {
        seen.add(product.id);
        products.push(product);
      }
    }
  }
  return products;
};

/**
 * The catalog's products for some filters, page by page, from the cache:
 * the web's useProductList (apps/web/src/features/catalog/hooks) plus what
 * pull-to-refresh needs.
 *
 * `products` flattens the pages without duplicates (flattenPages), once
 * per change of the pages (useMemo), not on every render.
 *
 * `loadMore` is for onEndReached and the footer's "Coba lagi": it asks for
 * the next page only when there is one and nothing is running, and it asks
 * once. FlashList can call onEndReached twice before the first call has
 * re-rendered anything (`isFetching` is still false), and fetchNextPage's
 * default cancels the running request and starts it again; the ref closes
 * that gap, `cancelRefetch: false` covers any other caller. Unchanged products keep their identity between
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
  const products = useMemo(() => flattenPages(pages), [pages]);

  const loadingMore = useRef(false);
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } =
    query;
  const requestNextPage = () => {
    loadingMore.current = true;
    void fetchNextPage({ cancelRefetch: false }).finally(() => {
      loadingMore.current = false;
    });
  };
  const loadMore = () => {
    // Not while a request runs: a background refetch would be cancelled.
    // Not after a failed page: onEndReached fires again as soon as the
    // list moves, and loading by itself would loop; retryNextPage is the
    // buyer's way out.
    if (loadingMore.current || !hasNextPage || isFetching) return;
    if (isFetchNextPageError) return;
    requestNextPage();
  };
  // The footer's "Coba lagi" after a page failed: the same request, asked
  // for by the buyer.
  const retryNextPage = () => {
    if (loadingMore.current || !hasNextPage) return;
    requestNextPage();
  };
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
    // Still exported: the guarded loadMore and retryNextPage are what the
    // list calls; this is TanStack's own, unguarded.
    fetchNextPage,
    loadMore,
    retryNextPage,
    refetch: query.refetch,
    refresh,
    isRefreshing,
  };
};
