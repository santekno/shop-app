import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getAdminProduct,
  listAdminProducts,
  listCategories,
} from "@goshop/shared";
import type { ApiClient, ListAdminProductsQuery } from "@goshop/shared";
import { api } from "@/lib/api.ts";

/**
 * The query keys of the products section, in one place. A key is an
 * array, like a path: TanStack Query compares it by value, and a prefix
 * matches every longer key, so invalidating ["admin", "products"] after a
 * save (artikel 03) refetches every page of the table at once.
 *
 *   ["categories"]
 *   ["admin", "products"]
 *   ["admin", "products", "table"]                                  every page
 *   ["admin", "products", "table", { q, status, …, page, per_page }] one page
 *   ["admin", "products", "detail", id]                             one product
 */
export const productKeys = {
  categories: ["categories"] as const,
  all: ["admin", "products"] as const,
  tables: ["admin", "products", "table"] as const,
  table: (query: ListAdminProductsQuery) =>
    [...productKeys.tables, query] as const,
  detail: (id: string) => [...productKeys.all, "detail", id] as const,
};

/** Categories rarely change: fresh for five minutes, as in the storefront. */
const CATEGORIES_STALE_TIME_MS = 5 * 60_000;

/**
 * GET /v1/categories, for the category filter. A public endpoint, so the
 * plain client: no token needed.
 */
export const categoriesQuery = () =>
  queryOptions({
    queryKey: productKeys.categories,
    queryFn: ({ signal }) => listCategories(api, { signal }),
    staleTime: CATEGORIES_STALE_TIME_MS,
  });

/**
 * One page of GET /v1/admin/products as query options.
 *
 * The whole query is in the key: every search, filter, sort, page and
 * page size is its own cache entry, so going back to page 1 shows the
 * cached page at once (and refetches it if it is older than staleTime).
 *
 * `placeholderData: keepPreviousData`: while a new page is on its way, the
 * table keeps showing the last page it had instead of emptying into a
 * spinner; `isPlaceholderData` says so, and the table shows that it is
 * busy. Without it, every click on "Berikutnya" would make the table
 * collapse and grow again, and the pagination under it would jump away
 * from the pointer.
 *
 * `client` is the session's authApi (the endpoint is staff only). It is
 * not part of the key: the cache is cleared on logout (App.tsx), so a
 * second user never sees the first one's entries.
 */
export const productTableQuery = (
  client: ApiClient,
  query: ListAdminProductsQuery,
) =>
  queryOptions({
    queryKey: productKeys.table(query),
    queryFn: ({ signal }) => listAdminProducts(client, query, { signal }),
    placeholderData: keepPreviousData,
  });

/**
 * GET /v1/admin/products/{id} as query options: the product the edit page
 * loads into its form, as the logged-in user.
 *
 * `retry` stays off (the client already retries the network), and a
 * NOT_FOUND is final: the page says so instead of retrying.
 */
export const adminProductQuery = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: productKeys.detail(id),
    queryFn: ({ signal }) => getAdminProduct(client, id, { signal }),
  });
