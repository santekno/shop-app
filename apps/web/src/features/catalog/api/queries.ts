import { queryOptions } from "@tanstack/react-query";
import { listCategories } from "@goshop/shared";
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
 */
export const categoriesQuery = () =>
  queryOptions({
    queryKey: catalogKeys.categories,
    queryFn: ({ signal }) => listCategories(api, { signal }),
    staleTime: CATEGORIES_STALE_TIME_MS,
  });
