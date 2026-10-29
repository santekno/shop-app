"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isApiError, viewItemListEvent } from "@goshop/shared";
import type { AnalyticsList, Category } from "@goshop/shared";
import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useTrackOnce } from "@/features/analytics/useTrackOnce.ts";
import { categoriesQuery } from "../api/queries.ts";
import {
  CATALOG_PAGE_SIZE,
  catalogSearch,
  readCatalogFilters,
} from "../catalog-filters.ts";
import type { CatalogFilters } from "../catalog-filters.ts";
import { useProductList } from "../hooks/useProductList.ts";
import { CatalogToolbar } from "./CatalogToolbar.tsx";
import { CategorySection } from "./CategorySection.tsx";
import { ProductGrid } from "./ProductGrid.tsx";
import { ProductListFooter } from "./ProductListFooter.tsx";

/**
 * Which list the buyer is looking at, for analytics (artikel 13): a
 * category by its slug and name, a search, or the whole catalog. The
 * search text itself is not sent: it is whatever a buyer typed, and it
 * could be anything, a name or a phone number included.
 */
const analyticsList = (
  filters: CatalogFilters,
  categories: readonly Category[] | undefined,
): AnalyticsList => {
  if (filters.q !== undefined) {
    return { item_list_id: "pencarian", item_list_name: "Hasil pencarian" };
  }
  if (filters.category !== undefined) {
    const category = categories?.find((c) => c.slug === filters.category);
    return {
      item_list_id: filters.category,
      item_list_name: category?.name ?? filters.category,
    };
  }
  return { item_list_id: "katalog", item_list_name: "Katalog" };
};

/**
 * The storefront's home, at "/": categories beside the products, filtered
 * by the query string (/?kategori=kaos&q=polos&urut=termurah).
 *
 * The filters live in the URL, not in useState: the URL is state that
 * survives a reload, can be bookmarked and shared, and moves with Back
 * and Forward. useSearchParams (next/navigation) reads it; a change of
 * filters is a navigation to the new URL (router.push), so the server
 * renders the new list too (Bab 11 artikel 09).
 *
 * The page cursor is the one piece of list state kept out of the URL. It
 * is opaque, valid only with the filters it came from, and names one page,
 * while the screen shows every page loaded so far; so the URL holds the
 * filters, and a change of filters starts another list from page one.
 */
export function CatalogPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const filters = readCatalogFilters(searchParams);
  const {
    data,
    products,
    status,
    error,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useProductList({ ...filters, limit: CATALOG_PAGE_SIZE });

  // view_item_list (artikel 13): the first page of each set of filters,
  // once, as soon as it is on screen (from the server's HTML, it is there
  // at hydration). The later pages are not new lists. The categories
  // give the list its name; the server fetched them too.
  const categories = useQuery(categoriesQuery());
  const firstPage = data?.pages[0]?.data;
  useTrackOnce(
    firstPage === undefined || firstPage.length === 0 || categories.isPending
      ? null
      : viewItemListEvent(analyticsList(filters, categories.data), firstPage),
    JSON.stringify(filters),
  );

  // scroll: false keeps the buyer where they are: the toolbar they just
  // used stays in view.
  const setFilters = (next: CatalogFilters) => {
    router.push(`/${catalogSearch(next)}`, { scroll: false });
  };

  // Whether any page has arrived. It decides what this page shows, not
  // `status`: when a *later* page fails, status becomes "error" too, yet
  // `data` keeps every page loaded before it (isFetchNextPageError is
  // true). Those products stay on screen, and the footer offers to retry
  // that one page. Only without any data is the error the whole list's.
  const hasPages = data !== undefined;

  return (
    <div className="grid gap-4">
      <h1 tabIndex={-1}>Katalog</h1>
      {/* Mobile first: one column, the categories above the products.
          From md (48rem) up, two columns: a 14rem sidebar beside them. */}
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:items-start">
        <aside>
          <CategorySection filters={filters} />
        </aside>
        <Section title="Produk">
          <CatalogToolbar filters={filters} onChange={setFilters} />
          {filters.q !== undefined && (
            <p className="text-muted-foreground">
              Hasil pencarian untuk “{filters.q}”.
            </p>
          )}

          {!hasPages && (status === "pending" || isFetching) && (
            <div className="mt-4 flex justify-center">
              <LoadingState>Memuat produk…</LoadingState>
            </div>
          )}
          {!hasPages &&
            status === "error" &&
            !isFetching &&
            // A slug that looks right but names no category: say so,
            // instead of offering a retry that would fail the same way.
            (isApiError(error, "UNKNOWN_CATEGORY") ? (
              <EmptyState>
                Kategori ini tidak ada.{" "}
                <Link
                  href={`/${catalogSearch({ ...filters, category: undefined })}`}
                >
                  Lihat semua produk
                </Link>
              </EmptyState>
            ) : (
              <ErrorState
                error={error}
                onRetry={() => {
                  void refetch();
                }}
              />
            ))}

          {hasPages && (
            <>
              {products.length > 0 && <ProductGrid products={products} />}
              <ProductListFooter
                count={products.length}
                filtered={
                  filters.q !== undefined || filters.category !== undefined
                }
                hasNextPage={hasNextPage}
                isFetching={isFetching}
                isFetchingNextPage={isFetchingNextPage}
                isFetchNextPageError={isFetchNextPageError}
                error={error}
                fetchNextPage={() => {
                  void fetchNextPage();
                }}
              />
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
