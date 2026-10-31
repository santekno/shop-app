// The category list, through @goshop/shared: the endpoint function
// (listCategories), the client (src/lib/api.ts) and the Category type are
// the ones apps/web uses, generated from api/openapi.yaml. The query
// options mirror apps/web's categoriesQuery
// (apps/web/src/features/catalog/api/queries.ts), with the same key.
import { queryOptions } from "@tanstack/react-query";
import { listCategories } from "@goshop/shared";
import { api } from "@/lib/api";

/** The cache key of GET /v1/categories, the same array as on the web. */
export const categoryKeys = {
  all: ["categories"] as const,
};

/** Categories rarely change: fresh for five minutes, not the default 0. */
const CATEGORIES_STALE_TIME_MS = 5 * 60_000;

/**
 * GET /v1/categories as query options: the key and the function that
 * fetches it, kept together so every use agrees on both. The API sends the
 * whole list at once (it is small, so it is not paginated), parents before
 * children; listCategories unwraps the `{ data }` envelope.
 *
 * TanStack Query hands queryFn an AbortSignal: leaving the screen before
 * the answer arrives cancels the request instead of leaving it running.
 */
export const categoriesQuery = () =>
  queryOptions({
    queryKey: categoryKeys.all,
    queryFn: ({ signal }) => listCategories(api, { signal }),
    staleTime: CATEGORIES_STALE_TIME_MS,
  });
