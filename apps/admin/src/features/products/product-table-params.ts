import type {
  AdminProductSort,
  AdminProductStatus,
  ListAdminProductsQuery,
  SortOrder,
} from "@goshop/shared";

/**
 * The product table's state, as read from the URL: what is searched and
 * filtered, how it is sorted, and which page of how many rows is shown.
 * Every field holds a value the API accepts; readProductTableParams makes
 * sure of that.
 */
export interface ProductTableParams {
  /** Search text (name or SKU), trimmed; undefined when there is none. */
  q: string | undefined;
  status: AdminProductStatus | undefined;
  /** A category ID; its child categories are included by the API. */
  categoryId: string | undefined;
  /** Only products with a variant at 5 units or fewer. */
  lowStock: boolean;
  sort: AdminProductSort;
  order: SortOrder;
  /** 1 for the first page. */
  page: number;
  perPage: PageSize;
}

/**
 * The statuses a seller can filter by: the API's value, the word in the
 * URL (Indonesian, like the paths) and the label on screen, which the
 * status badge uses too. `satisfies` checks every `value` against the
 * generated type and keeps the literal types.
 */
export const STATUS_OPTIONS = [
  { value: "active", param: "aktif", label: "Aktif" },
  { value: "draft", param: "draf", label: "Draf" },
  { value: "archived", param: "arsip", label: "Diarsipkan" },
] as const satisfies readonly {
  value: AdminProductStatus;
  param: string;
  label: string;
}[];

/** The sortable columns: the API's value and the word in the URL. */
export const SORT_OPTIONS = [
  { value: "name", param: "nama" },
  { value: "price_from", param: "harga" },
  { value: "stock", param: "stok" },
  { value: "updated_at", param: "diubah" },
  { value: "created_at", param: "dibuat" },
] as const satisfies readonly { value: AdminProductSort; param: string }[];

const ORDER_OPTIONS = [
  { value: "asc", param: "naik" },
  { value: "desc", param: "turun" },
] as const satisfies readonly { value: SortOrder; param: string }[];

/** The page sizes the "Baris per halaman" menu offers. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/** The table as it is with nothing in the URL: the API's own defaults. */
export const DEFAULT_PRODUCT_TABLE_PARAMS: ProductTableParams = {
  q: undefined,
  status: undefined,
  categoryId: undefined,
  lowStock: false,
  sort: "updated_at",
  order: "desc",
  page: 1,
  perPage: 20,
};

/**
 * The query-string names:
 * /produk?q=kaos&status=aktif&kategori=<id>&stok=menipis&urut=harga&arah=naik&halaman=2&per_halaman=50
 */
const PARAM = {
  q: "q",
  status: "status",
  categoryId: "kategori",
  lowStock: "stok",
  sort: "urut",
  order: "arah",
  page: "halaman",
  perPage: "per_halaman",
} as const;

/** The value of `stok` that turns the low-stock filter on. */
const LOW_STOCK_PARAM = "menipis";

/** The contract's limits: `q` up to 100 characters, `page` up to 10000. */
export const MAX_QUERY_LENGTH = 100;
export const MAX_PAGE = 10_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE_NUMBER = /^[1-9][0-9]*$/;

/**
 * Search text as the API counts it: trimmed, at most 100 characters. The
 * API counts characters (Go runes); Array.from splits by code point, not
 * by UTF-16 unit, so an emoji counts once here too. Only spaces is no
 * search at all (undefined).
 */
export const normaliseQuery = (text: string): string | undefined => {
  const q = Array.from(text.trim()).slice(0, MAX_QUERY_LENGTH).join("").trim();
  return q === "" ? undefined : q;
};

/** The option whose URL word is `param`, or undefined. */
const byParam = <T extends { param: string }>(
  options: readonly T[],
  param: string | null,
): T | undefined => options.find((option) => option.param === param);

/** The option whose API value is `value`, or undefined. */
const byValue = <T extends { value: string }>(
  options: readonly T[],
  value: string,
): T | undefined => options.find((option) => option.value === value);

const readPage = (param: string | null): number => {
  if (param === null || !WHOLE_NUMBER.test(param)) return 1;
  const page = Number(param);
  return page <= MAX_PAGE ? page : 1;
};

const readPageSize = (param: string | null): PageSize =>
  PAGE_SIZE_OPTIONS.find((size) => String(size) === param) ??
  DEFAULT_PRODUCT_TABLE_PARAMS.perPage;

/**
 * Reads the table's state from the query string.
 *
 * The URL is input from outside, like a request to a Go handler: anyone
 * can type, bookmark or share any address. So every value is checked, and
 * one the API would refuse falls back to its default instead of being
 * sent: `?halaman=-3` is page 1, `?urut=warna` is the default sort,
 * `?per_halaman=7` is 20 rows. The table then shows something sensible
 * rather than a 400 VALIDATION_FAILED. (A well-formed category ID that
 * names no category still reaches the API, which answers an empty page.)
 */
export const readProductTableParams = (
  params: URLSearchParams,
): ProductTableParams => {
  const categoryId = params.get(PARAM.categoryId) ?? "";
  return {
    q: normaliseQuery(params.get(PARAM.q) ?? ""),
    status: byParam(STATUS_OPTIONS, params.get(PARAM.status))?.value,
    categoryId: UUID_PATTERN.test(categoryId)
      ? categoryId.toLowerCase()
      : undefined,
    lowStock: params.get(PARAM.lowStock) === LOW_STOCK_PARAM,
    sort:
      byParam(SORT_OPTIONS, params.get(PARAM.sort))?.value ??
      DEFAULT_PRODUCT_TABLE_PARAMS.sort,
    order:
      byParam(ORDER_OPTIONS, params.get(PARAM.order))?.value ??
      DEFAULT_PRODUCT_TABLE_PARAMS.order,
    page: readPage(params.get(PARAM.page)),
    perPage: readPageSize(params.get(PARAM.perPage)),
  };
};

/**
 * The query string for a table state, the reverse of
 * readProductTableParams. Defaults are left out, so the plain table is
 * /produk and not /produk?urut=diubah&arah=turun&halaman=1, and the order
 * of the parameters is fixed, so equal states always give equal URLs.
 */
export const productTableSearchParams = (
  state: ProductTableParams,
): URLSearchParams => {
  const defaults = DEFAULT_PRODUCT_TABLE_PARAMS;
  const params = new URLSearchParams();
  if (state.q !== undefined) params.set(PARAM.q, state.q);
  if (state.status !== undefined) {
    params.set(
      PARAM.status,
      byValue(STATUS_OPTIONS, state.status)?.param ?? "",
    );
  }
  if (state.categoryId !== undefined) {
    params.set(PARAM.categoryId, state.categoryId);
  }
  if (state.lowStock) params.set(PARAM.lowStock, LOW_STOCK_PARAM);
  if (state.sort !== defaults.sort) {
    params.set(PARAM.sort, byValue(SORT_OPTIONS, state.sort)?.param ?? "");
  }
  if (state.order !== defaults.order) {
    params.set(PARAM.order, byValue(ORDER_OPTIONS, state.order)?.param ?? "");
  }
  if (state.page !== defaults.page) params.set(PARAM.page, String(state.page));
  if (state.perPage !== defaults.perPage) {
    params.set(PARAM.perPage, String(state.perPage));
  }
  return params;
};

/**
 * The next state after a change: `{ ...current, page: 1, ...change }`.
 * Any change but the page itself starts again at page 1, because page 4
 * of yesterday's search means nothing for today's; a change that names
 * its page (the pagination buttons) keeps it.
 */
export const nextProductTableParams = (
  current: ProductTableParams,
  change: Partial<ProductTableParams>,
): ProductTableParams => ({ ...current, page: 1, ...change });

/** Whether a search or a filter narrows the table (sorting and paging do not). */
export const hasActiveFilters = ({
  q,
  status,
  categoryId,
  lowStock,
}: ProductTableParams): boolean =>
  q !== undefined ||
  status !== undefined ||
  categoryId !== undefined ||
  lowStock;

/** The change that clears every search and filter, keeping sort and page size. */
export const CLEAR_FILTERS: Partial<ProductTableParams> = {
  q: undefined,
  status: undefined,
  categoryId: undefined,
  lowStock: false,
};

/**
 * The query of GET /v1/admin/products for a table state, in the API's
 * names. Every parameter is sent, defaults included, so the request (and
 * the query key built from it) says exactly what was asked for.
 */
export const toListAdminProductsQuery = (
  state: ProductTableParams,
): ListAdminProductsQuery => ({
  q: state.q,
  status: state.status,
  category_id: state.categoryId,
  // Only `true` is sent: `low_stock=false` is the API's default.
  low_stock: state.lowStock ? true : undefined,
  sort: state.sort,
  order: state.order,
  page: state.page,
  per_page: state.perPage,
});

/** A type guard: whether a column ID is a column the API sorts by. */
export const isSortableColumn = (id: string): id is AdminProductSort =>
  SORT_OPTIONS.some((option) => option.value === id);
