import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type { AdminProductTable, ListAdminProductsQuery } from "./types.ts";

/**
 * GET /v1/admin/products: one numbered page of the dashboard's product
 * table, every status, with the total on every page. Returns the whole
 * body, `{ data, page }`: the table needs `page.total` and
 * `page.total_pages` for "Halaman 2 dari 5".
 *
 * Staff only, so `api` must be a client that sends the access token (the
 * dashboard's `authApi`); the plain client gets 401. Throws
 * VALIDATION_FAILED for a query the contract refuses (an unknown sort, a
 * `page` above 10000, a `q` longer than 100 characters), UNAUTHORIZED, or
 * FORBIDDEN for a buyer.
 *
 * Offset pages, unlike the catalog's cursors: a table jumps to page N and
 * sorts by any column. A page past the last one is an empty `data` with
 * the real `page.total`.
 *
 * @example
 *   const table = await listAdminProducts(authApi, {
 *     status: "active",
 *     sort: "price_from",
 *     order: "asc",
 *     page: 2,
 *     per_page: 20,
 *   });
 *   table.page.total_pages; // 5
 */
export const listAdminProducts = (
  api: ApiClient,
  query: ListAdminProductsQuery = {},
  { signal }: EndpointOptions = {},
): Promise<AdminProductTable> =>
  api.request<AdminProductTable>("/v1/admin/products", { query, signal });
