import type { ListProductsQuery } from "@goshop/shared";

/** The API's sort orders, taken from the generated query type. */
export type ProductSort = NonNullable<ListProductsQuery["sort"]>;

/** Products per page: a grid of 3 or 4 columns fills evenly. The server
 *  (app/page.tsx) and the browser must ask for the same page size, or the
 *  browser would not find the server's first page in its cache. */
export const CATALOG_PAGE_SIZE = 12;

/** What the catalog shows, as read from the URL. */
export interface CatalogFilters {
  /** A category slug; products of its sub-categories are included. */
  category: string | undefined;
  /** Search text, trimmed; undefined when there is none. */
  q: string | undefined;
  sort: ProductSort;
}

/**
 * The sort orders a buyer can pick: the API's value, the word in the URL
 * (Indonesian, like the paths) and the label in the menu. `satisfies`
 * checks every `value` against ProductSort and still keeps the literal
 * types, so a sort the API does not know is a compile error.
 */
export const SORT_OPTIONS = [
  { value: "newest", param: "terbaru", label: "Terbaru" },
  { value: "price_asc", param: "termurah", label: "Harga terendah" },
  { value: "price_desc", param: "termahal", label: "Harga tertinggi" },
] as const satisfies readonly {
  value: ProductSort;
  param: string;
  label: string;
}[];

const DEFAULT_SORT: ProductSort = "newest";

/** The query-string names: /?kategori=kaos&q=polos&urut=termurah. */
const PARAM = { category: "kategori", q: "q", sort: "urut" } as const;

/** The contract's category slug pattern and the API's limit on `q`. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CATEGORY_LENGTH = 100;
const MAX_QUERY_LENGTH = 100;

/**
 * Reads the catalog's filters from the query string.
 *
 * The URL is input from outside, like a request to a Go handler: anyone
 * can type or share any address. So every value is checked, and one that
 * cannot be valid is ignored instead of sent: a malformed category or an
 * unknown sort word shows the whole catalog, newest first, rather than an
 * API error. (A well-formed slug that names no category still reaches the
 * API, which answers UNKNOWN_CATEGORY; CatalogPage says so.)
 */
export const readCatalogFilters = (
  params: Pick<URLSearchParams, "get">,
): CatalogFilters => {
  const category = params.get(PARAM.category) ?? "";
  // The API counts characters (Go runes); Array.from splits by code
  // point, not by UTF-16 unit, so an emoji counts once there too.
  const q = Array.from((params.get(PARAM.q) ?? "").trim())
    .slice(0, MAX_QUERY_LENGTH)
    .join("");
  const sortParam = params.get(PARAM.sort);
  const sort =
    SORT_OPTIONS.find((option) => option.param === sortParam)?.value ??
    DEFAULT_SORT;
  return {
    category:
      category.length <= MAX_CATEGORY_LENGTH && SLUG_PATTERN.test(category)
        ? category
        : undefined,
    q: q === "" ? undefined : q,
    sort,
  };
};

/**
 * The query string for a set of filters, the reverse of readCatalogFilters.
 * Defaults are left out, so the plain catalog is "/" and not "/?urut=terbaru",
 * and the order is fixed, so equal filters always give the same URL.
 */
export const catalogSearchParams = ({
  category,
  q,
  sort,
}: CatalogFilters): URLSearchParams => {
  const params = new URLSearchParams();
  if (category !== undefined) params.set(PARAM.category, category);
  if (q !== undefined) params.set(PARAM.q, q);
  if (sort !== DEFAULT_SORT) {
    const option = SORT_OPTIONS.find((o) => o.value === sort);
    if (option !== undefined) params.set(PARAM.sort, option.param);
  }
  return params;
};

/** catalogSearchParams as the "?…" part of a link, or "" for none. */
export const catalogSearch = (filters: CatalogFilters): string => {
  const search = catalogSearchParams(filters).toString();
  return search === "" ? "" : `?${search}`;
};
