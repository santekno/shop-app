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
import { useProducts } from "../hooks/useProducts.ts";
import { CatalogToolbar } from "./CatalogToolbar.tsx";
import { CategorySection } from "./CategorySection.tsx";
import { ProductGrid } from "./ProductGrid.tsx";

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
 * filters, and a change of filters starts the list again from page one.
 */
export function CatalogPage() {
  useDocumentTitle("Katalog — GoShop");
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readCatalogFilters(searchParams);
  const { products, phase, error, hasMore, loadMore, retry } = useProducts({
    ...filters,
    limit: PAGE_SIZE,
  });

  const setFilters = (next: CatalogFilters) => {
    setSearchParams(catalogSearchParams(next));
  };

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

          {products.length > 0 && <ProductGrid products={products} />}

          <div className="catalog__footer">
            {phase === "loading" && (
              <LoadingState>
                {products.length === 0
                  ? "Memuat produk…"
                  : "Memuat produk berikutnya…"}
              </LoadingState>
            )}
            {phase === "error" &&
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
                <ErrorState error={error} onRetry={retry} />
              ))}
            {phase === "ready" && hasMore && (
              <button type="button" onClick={loadMore}>
                Muat lebih banyak
              </button>
            )}
            {phase === "ready" && !hasMore && (
              <EmptyState>
                {products.length === 0
                  ? filters.q !== undefined || filters.category !== undefined
                    ? "Tidak ada produk yang cocok."
                    : "Belum ada produk."
                  : "Semua produk sudah ditampilkan."}
              </EmptyState>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
