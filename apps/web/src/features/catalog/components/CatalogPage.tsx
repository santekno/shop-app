import { Link, useSearchParams } from "react-router";
import { isApiError } from "@goshop/shared";
import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import {
  catalogSearch,
  catalogSearchParams,
  readCatalogFilters,
} from "../catalog-filters.ts";
import type { CatalogFilters } from "../catalog-filters.ts";
import { useProductList } from "../hooks/useProductList.ts";
import { CatalogToolbar } from "./CatalogToolbar.tsx";
import { CategorySection } from "./CategorySection.tsx";
import { ProductGrid } from "./ProductGrid.tsx";
import { ProductListFooter } from "./ProductListFooter.tsx";

/** Products per page: a grid of 3 or 4 columns fills evenly. */
const PAGE_SIZE = 12;

/**
 * The storefront's home, at "/": categories beside the products, filtered
 * by the query string (/?kategori=kaos&q=polos&urut=termurah).
 *
 * The filters live in the URL, not in useState: the URL is state that
 * survives a reload, can be bookmarked and shared, and moves with Back
 * and Forward. useSearchParams reads it like useState and writes it with
 * setSearchParams, which navigates to the new URL.
 *
 * The page cursor is the one piece of list state kept out of the URL. It
 * is opaque, valid only with the filters it came from, and names one page,
 * while the screen shows every page loaded so far; so the URL holds the
 * filters, and a change of filters starts another list from page one.
 */
export function CatalogPage() {
  useDocumentTitle("Katalog — GoShop");
  const [searchParams, setSearchParams] = useSearchParams();
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
  } = useProductList({ ...filters, limit: PAGE_SIZE });

  const setFilters = (next: CatalogFilters) => {
    setSearchParams(catalogSearchParams(next));
  };

  // Whether any page has arrived. It decides what this page shows, not
  // `status`: when a *later* page fails, status becomes "error" too, yet
  // `data` keeps every page loaded before it (isFetchNextPageError is
  // true). Those products stay on screen, and the footer offers to retry
  // that one page. Only without any data is the error the whole list's.
  const hasPages = data !== undefined;

  return (
    <div className="page">
      <h1 tabIndex={-1}>Katalog</h1>
      <div className="catalog">
        <aside className="catalog__aside">
          <CategorySection filters={filters} />
        </aside>
        <Section title="Produk" className="catalog__products">
          <CatalogToolbar filters={filters} onChange={setFilters} />
          {filters.q !== undefined && (
            <p className="muted">Hasil pencarian untuk “{filters.q}”.</p>
          )}

          {!hasPages && (status === "pending" || isFetching) && (
            <div className="catalog__footer">
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
                  to={`/${catalogSearch({ ...filters, category: undefined })}`}
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
