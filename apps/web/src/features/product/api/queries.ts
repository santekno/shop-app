import { queryOptions } from "@tanstack/react-query";
import { getProduct } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";
import { catalogKeys } from "@/features/catalog/api/queries.ts";
import { api } from "@/lib/api.ts";

/**
 * GET /v1/products/{slug} as query options. The product page reads it
 * with useQuery; a slug that names no product fails with an ApiError
 * whose code is NOT_FOUND.
 */
export const productQuery = (slug: string, client: ApiClient = api) =>
  queryOptions({
    queryKey: catalogKeys.productDetail(slug),
    queryFn: ({ signal }) => getProduct(client, slug, { signal }),
  });
