import type { ApiClient, RequestOptions } from "./client.ts";
import type {
  Category,
  CategoryList,
  ListProductsQuery,
  Product,
  ProductDetail,
  ProductList,
} from "./types.ts";

/** Options every endpoint function accepts: only the abort signal. */
export type EndpointOptions = Pick<RequestOptions, "signal">;

/**
 * GET /v1/categories: every category, parents before children, sorted by
 * name. Returns the list itself rather than the `{ data }` envelope.
 *
 * @example
 *   const categories = await listCategories(api, { signal });
 */
export const listCategories = async (
  api: ApiClient,
  { signal }: EndpointOptions = {},
): Promise<Category[]> => {
  const body = await api.request<CategoryList>("/v1/categories", { signal });
  return body.data;
};

/**
 * GET /v1/products: one page of active products. Returns the whole body,
 * `{ data, page }`, because the caller needs `page.next_cursor` to ask for
 * the next page: pass it back as `cursor`, with the same filters, until it
 * is null.
 *
 * @example
 *   const first = await listProducts(api, { category: "kaos", limit: 12 });
 *   const next = first.page.next_cursor
 *     ? await listProducts(api, { category: "kaos", limit: 12, cursor: first.page.next_cursor })
 *     : undefined;
 */
export const listProducts = (
  api: ApiClient,
  query: ListProductsQuery = {},
  { signal }: EndpointOptions = {},
): Promise<ProductList> =>
  api.request<ProductList>("/v1/products", { query, signal });

/**
 * GET /v1/products/{slug}: one active product with its sellable variants.
 * A slug that names no product throws an ApiError with code NOT_FOUND.
 *
 * The slug is a path segment, so it is encoded: a "/" or "?" in it must not
 * change which URL is called.
 */
export const getProduct = async (
  api: ApiClient,
  slug: string,
  { signal }: EndpointOptions = {},
): Promise<Product> => {
  const body = await api.request<ProductDetail>(
    `/v1/products/${encodeURIComponent(slug)}`,
    { signal },
  );
  return body.data;
};
