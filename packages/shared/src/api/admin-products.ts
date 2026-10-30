import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  AdminProduct,
  AdminProductDetail,
  AdminProductTable,
  ListAdminProductsQuery,
  ProductWrite,
} from "./types.ts";

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

/** The path of one product; the ID is escaped, so a pasted URL stays a path. */
const productPath = (id: string) =>
  `/v1/admin/products/${encodeURIComponent(id)}`;

/**
 * GET /v1/admin/products/{id}: one product in any status, with its
 * sellable variants (each with the `version` a PUT must send back) and
 * every photo. Returns the product itself, not the `{ data }` envelope.
 * Throws NOT_FOUND for an unknown ID (or one that is not a UUID).
 */
export const getAdminProduct = async (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const body = await api.request<AdminProductDetail>(productPath(id), {
    signal,
  });
  return body.data;
};

/**
 * POST /v1/admin/products: creates the product and its variants in one
 * transaction and returns it as stored (SKUs upper-cased, `price_from`
 * computed). Variants must not carry an `id`. Throws VALIDATION_FAILED
 * (one entry per field, such as `variants[0].price`), UNKNOWN_CATEGORY,
 * SLUG_TAKEN or SKU_TAKEN.
 *
 * Never retried, like every POST: a second create after a lost answer
 * would be refused as SLUG_TAKEN at best.
 */
export const createProduct = async (
  api: ApiClient,
  body: ProductWrite,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const response = await api.request<AdminProductDetail>("/v1/admin/products", {
    method: "POST",
    body,
    signal,
  });
  return response.data;
};

/**
 * PUT /v1/admin/products/{id}: saves the whole product. A variant with an
 * `id` is updated and must carry the `version` it was loaded with; one
 * without is added; a sellable variant left out is archived. Throws what
 * createProduct throws, NOT_FOUND, and VERSION_CONFLICT (`details.
 * variant_id`) when a variant changed since it was loaded: nothing was
 * saved, reload and save again.
 */
export const updateProduct = async (
  api: ApiClient,
  id: string,
  body: ProductWrite,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const response = await api.request<AdminProductDetail>(productPath(id), {
    method: "PUT",
    body,
    signal,
  });
  return response.data;
};

/**
 * DELETE /v1/admin/products/{id}: archives the product (takes it off the
 * storefront). Nothing is deleted; saving it again with another status
 * restores it. Archiving an archived product succeeds too. Throws
 * NOT_FOUND for an unknown ID.
 */
export const archiveProduct = async (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<void> => {
  await api.request<undefined>(productPath(id), { method: "DELETE", signal });
};
