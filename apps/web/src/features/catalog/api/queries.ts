import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { listCategories, listProducts } from "@goshop/shared";
import type { ApiClient, ListProductsQuery } from "@goshop/shared";
import { api } from "@/lib/api.ts";

/**
 * The query keys of the catalog, in one place. A key is an array, like a
 * path: TanStack Query compares it by value, and a prefix matches every
 * longer key, so invalidating ["products"] reaches every product list and
 * every product page at once.
 *
 *   ["categories"]
 *   ["products"]
 *   ["products", "list", { category, q, sort, limit }]
 *   ["products", "detail", slug]
 */
export const catalogKeys = {
  categories: ["categories"] as const,
  products: ["products"] as const,
  productLists: () => [...catalogKeys.products, "list"] as const,
  productList: (filters: ProductListFilters) =>
    [...catalogKeys.productLists(), filters] as const,
  productDetail: (slug: string) =>
    [...catalogKeys.products, "detail", slug] as const,
};

/** Categories rarely change: fresh for five minutes, not the default 30 s. */
const CATEGORIES_STALE_TIME_MS = 5 * 60_000;

/**
 * GET /v1/categories as query options: the key and the function that
 * fetches it, kept together so every use (useQuery, queryClient.query,
 * getQueryData) agrees on both. queryOptions also carries the data type
 * on the key, so queryClient.getQueryData(categoriesQuery().queryKey) is
 * typed as Category[] | undefined.
 *
 * TanStack Query hands queryFn an AbortSignal. Passing it to the API
 * client keeps Bab 8's rule: a request nobody waits for any more (the
 * page was left before it answered) is aborted, not left running.
 *
 * `client` is the browser's API client unless a server component passes
 * its own (lib/server-api.ts, Bab 11 artikel 09): the same key, so what
 * the server fetched is what the browser's cache finds.
 */
export const categoriesQuery = (client: ApiClient = api) =>
  queryOptions({
    queryKey: catalogKeys.categories,
    queryFn: ({ signal }) => listCategories(client, { signal }),
    staleTime: CATEGORIES_STALE_TIME_MS,
  });

/** What narrows a product list: the query of GET /v1/products without
 *  the cursor, which the infinite query manages. */
export type ProductListFilters = Omit<ListProductsQuery, "cursor">;

/**
 * GET /v1/products, page by page, as infinite query options.
 *
 * An infinite query is one cache entry holding a list of pages. Each page
 * is fetched with a `pageParam`: null for the first one, then whatever
 * getNextPageParam returns from the last page, here its next_cursor. When
 * it returns undefined there is no next page (hasNextPage is false).
 *
 * The filters are part of the key, so each combination of category,
 * search and sort is its own list, and the cursor (valid only with the
 * filters it came from) never crosses from one to another. The filters
 * object can be written fresh on every render: keys are compared by
 * value, not by identity.
 */
export const productListQuery = (
  filters: ProductListFilters,
  client: ApiClient = api,
) =>
  infiniteQueryOptions({
    queryKey: catalogKeys.productList(filters),
    queryFn: ({ pageParam, signal }) =>
      listProducts(
        client,
        { ...filters, cursor: pageParam ?? undefined },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const next = lastPage.page.next_cursor;
      // A next cursor equal to the one just used would ask for the same
      // page forever: treat it as the end of the list. The API never sends
      // one; this keeps a bug there from turning into an endless list.
      return next === null || next === lastPageParam ? undefined : next;
    },
  });
