// The catalog's product list, through @goshop/shared: the endpoint function
// (listProducts), the client (src/lib/api.ts) and the types are the ones
// apps/web uses, generated from api/openapi.yaml. Nothing here is written
// for the phone except the page size.
import { listProducts } from "@goshop/shared";
import type { ListProductsQuery, ProductList } from "@goshop/shared";
import { api } from "@/lib/api";

/**
 * Products per page: two columns of ten rows, enough to fill a tall phone
 * screen and start the next page before the buyer reaches the end.
 */
export const CATALOG_PAGE_SIZE = 20;

/**
 * What narrows the list: category, search text, sort, and the page size.
 * The query of GET /v1/products without the cursor, which belongs to the
 * paging, not to the filters (the same type as apps/web's).
 */
export type ProductListFilters = Omit<ListProductsQuery, "cursor">;

/**
 * GET /v1/products: one page of active products. `cursor` is null for the
 * first page, then the `page.next_cursor` of the page before, with the
 * same filters; a `next_cursor` of null means there is no next page.
 * `signal` cancels the request (TanStack Query passes one, artikel 06).
 *
 * @example
 *   const first = await fetchProductPage({ category: "kaos" }, null);
 *   first.data; // Product[]
 *   first.page.next_cursor; // string | null
 */
export const fetchProductPage = (
  filters: ProductListFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ProductList> =>
  listProducts(
    api,
    { limit: CATALOG_PAGE_SIZE, ...filters, cursor: cursor ?? undefined },
    { signal },
  );
