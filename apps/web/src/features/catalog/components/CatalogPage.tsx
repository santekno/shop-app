import { useCallback } from "react";
import { useNavigate } from "react-router";
import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { CategorySection } from "./CategorySection.tsx";
import { ProductGrid } from "./ProductGrid.tsx";

/** Products per page: a grid of 3 or 4 columns fills evenly. */
const PAGE_SIZE = 12;

/** The storefront's home, at "/": categories beside the newest products. */
export function CatalogPage() {
  useDocumentTitle("Katalog — GoShop");
  const { products, phase, error, hasMore, loadMore, retry } = useProducts({
    limit: PAGE_SIZE,
  });

  // Opening a product is now a navigation: the URL changes, the router
  // renders the product route, and Back returns here. useNavigate gives
  // the same function on every render, so the memoised cards still skip
  // re-rendering.
  const navigate = useNavigate();
  const showProduct = useCallback(
    (slug: string) => {
      void navigate(`/produk/${encodeURIComponent(slug)}`);
    },
    [navigate],
  );

  return (
    <div className="page">
      <h1 tabIndex={-1}>Katalog</h1>
      <div className="catalog">
        <aside className="catalog__aside">
          <CategorySection />
        </aside>
        <Section title="Produk" className="catalog__products">
          {products.length > 0 && (
            <ProductGrid products={products} onSelectProduct={showProduct} />
          )}

          <div className="catalog__footer">
            {phase === "loading" && (
              <LoadingState>
                {products.length === 0
                  ? "Memuat produk…"
                  : "Memuat produk berikutnya…"}
              </LoadingState>
            )}
            {phase === "error" && <ErrorState error={error} onRetry={retry} />}
            {phase === "ready" && hasMore && (
              <button type="button" onClick={loadMore}>
                Muat lebih banyak
              </button>
            )}
            {phase === "ready" && !hasMore && (
              <EmptyState>
                {products.length === 0
                  ? "Belum ada produk."
                  : "Semua produk sudah ditampilkan."}
              </EmptyState>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
