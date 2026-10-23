import type { ApiClient, RequestOptions } from "./client.ts";
import type { Category, CategoryList } from "./types.ts";

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
