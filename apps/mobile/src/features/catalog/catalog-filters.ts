// The catalog's filters as Beranda's route carries them
// (/?kategori=kaos&q=polos&urut=termurah), read the way the storefront
// reads its query string (apps/web/src/features/catalog/catalog-filters.ts,
// readCatalogFilters): the same names, the same checks.
import type { ProductListFilters } from "./api/products";
import { sortFromParam } from "./sort-options";

/**
 * The contract's category slug pattern and the API's limits on `category`
 * and `q` (api/openapi.yaml, GET /v1/products), as on the web.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CATEGORY_LENGTH = 100;
const MAX_QUERY_LENGTH = 100;

/** A route parameter: absent, one value, or repeated (?q=a&q=b). */
type RouteParam = string | string[] | undefined;

/** Beranda's route parameters, in the route's (Indonesian) names. */
export interface CatalogRouteParams {
  kategori?: RouteParam;
  q?: RouteParam;
  urut?: RouteParam;
}

/**
 * The filters for GET /v1/products from Beranda's route parameters.
 *
 * A route parameter is input from outside: goshop://?kategori=…&q=… can
 * carry anything. So, as on the web:
 *
 * - `kategori` is sent as `category` only when it can be a slug (the
 *   contract's pattern, at most 100 characters); anything else shows the
 *   whole catalog instead of a 400. A well-formed slug that names no
 *   category still reaches the API, which answers UNKNOWN_CATEGORY, and
 *   the list says so;
 * - `q` is trimmed and cut to 100 characters (counted by code point, as
 *   the Go API counts runes); empty means no search;
 * - `urut` is the Indonesian word (terbaru, termurah, termahal) and
 *   becomes the API's `sort` (newest, price_asc, price_desc); an unknown
 *   word means the default, newest first.
 *
 * A repeated parameter (an array) counts as absent. Fields that are not
 * set stay out of the object, so the query key of the plain catalog is
 * the same however it was reached.
 *
 * @example
 *   readCatalogFilters({ kategori: "kaos", q: " polos ", urut: "termurah" });
 *   // { category: "kaos", q: "polos", sort: "price_asc" }
 */
export const readCatalogFilters = (
  params: CatalogRouteParams,
): ProductListFilters => {
  const category = typeof params.kategori === "string" ? params.kategori : "";
  const q =
    typeof params.q === "string"
      ? Array.from(params.q.trim()).slice(0, MAX_QUERY_LENGTH).join("")
      : "";
  return {
    ...(category.length <= MAX_CATEGORY_LENGTH &&
      SLUG_PATTERN.test(category) && { category }),
    ...(q !== "" && { q }),
    sort: sortFromParam(params.urut).value,
  };
};
