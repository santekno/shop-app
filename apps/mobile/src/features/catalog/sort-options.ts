// The catalog's sort orders, as the storefront offers them
// (apps/web/src/features/catalog/catalog-filters.ts): the API's value, the
// word the route carries (Indonesian, like the web's ?urut=…) and the
// label. A copy of the storefront's list, as src/lib/error-message.ts is of
// its sentences: packages/shared does not hold it (artikel 12 shared the
// types, the client and the schemas), so a new order is added in both.

export const SORT_OPTIONS = [
  { value: "newest", param: "terbaru", label: "Terbaru" },
  { value: "price_asc", param: "termurah", label: "Harga terendah" },
  { value: "price_desc", param: "termahal", label: "Harga tertinggi" },
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

/** Newest first, the API's default too. */
export const DEFAULT_SORT: SortOption = SORT_OPTIONS[0];

/**
 * The sort a route parameter asks for. A route parameter is outside input
 * (goshop://?urut=… can carry anything), so an unknown or repeated value
 * falls back to the default instead of reaching the API.
 */
export const sortFromParam = (
  param: string | string[] | undefined,
): SortOption =>
  SORT_OPTIONS.find((option) => option.param === param) ?? DEFAULT_SORT;
