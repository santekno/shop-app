import type { Category } from "@goshop/shared";
import { catalogSearch } from "./catalog-filters.ts";
import type { CatalogFilters } from "./catalog-filters.ts";

/** What the catalog page tells search engines about one URL. */
export interface CatalogPageMeta {
  title: string;
  description: string;
  /** The path of the one URL that should be indexed for this content;
   *  undefined for a page that should not be indexed at all. */
  canonicalPath: string | undefined;
  /** False: `noindex, follow` (the links are still worth following). */
  index: boolean;
}

const ALL_DESCRIPTION =
  "Belanja pakaian, elektronik, perlengkapan rumah, dan camilan di GoShop.";

/**
 * Which catalog URLs search engines should index (Bab 11 artikel 10).
 *
 * The catalog has three filters in its query string, and each combination
 * is a URL a crawler can find. Indexing all of them would split the shop
 * into many near-copies of the same list. The rule:
 *
 * | URL | Indexed | Canonical |
 * |---|---|---|
 * | `/` | yes | `/` |
 * | `/?kategori=kaos` (a category that exists) | yes | `/?kategori=kaos` |
 * | `?urut=termurah` added to either | yes | the same URL without `urut` |
 * | `?q=…` (a search) | no (`noindex, follow`) | none |
 * | `?kategori=…` that names no category | no (`noindex, follow`) | none |
 *
 * - A **category** is a real page: its own products, a name a buyer
 *   searches for. It is the one filter worth a search result.
 * - **Sorting** shows the same products in another order: the canonical
 *   link points at the unsorted URL, so search engines merge the two
 *   instead of choosing between them. Not `noindex` as well: a page that
 *   says "index my canonical" and "do not index me" sends two signals
 *   that contradict each other.
 * - **A search** is the shop's own search engine; Google asks sites to
 *   keep internal search results out of its index (endless, thin pages).
 *   `follow`, so the products it links to are still found.
 * - **An unknown category** shows "Kategori ini tidak ada" with status
 *   200 (the browser's message, Bab 9); `noindex` keeps it out.
 * - Anything the URL carries that readCatalogFilters ignores (a malformed
 *   slug, an unknown sort word, other parameters) is dropped from the
 *   canonical URL, because the filters it is built from are the parsed
 *   ones.
 *
 * `categories` null: the API did not answer; the category cannot be
 * checked, so the page is treated as one that exists.
 */
export const catalogPageMeta = (
  filters: CatalogFilters,
  categories: readonly Category[] | null,
): CatalogPageMeta => {
  if (filters.q !== undefined) {
    return {
      title: `Hasil pencarian “${filters.q}”`,
      description: `Produk GoShop untuk pencarian “${filters.q}”.`,
      canonicalPath: undefined,
      index: false,
    };
  }

  const canonicalPath = `/${catalogSearch({ ...filters, sort: "newest" })}`;
  if (filters.category === undefined) {
    return {
      title: "Katalog",
      description: ALL_DESCRIPTION,
      canonicalPath,
      index: true,
    };
  }

  const category = categories?.find((c) => c.slug === filters.category);
  if (categories !== null && category === undefined) {
    return {
      title: "Kategori tidak ditemukan",
      description: ALL_DESCRIPTION,
      canonicalPath: undefined,
      index: false,
    };
  }
  const name = category?.name ?? "Katalog";
  return {
    title: name,
    description: `Belanja ${name} di GoShop: harga, varian, dan stok terbaru.`,
    canonicalPath,
    index: true,
  };
};
