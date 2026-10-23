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

interface CatalogPageProps {
  /** Called with a product's slug when the buyer opens it. */
  onSelectProduct: (slug: string) => void;
}

/** The storefront's home: categories beside the newest products. */
export function CatalogPage({ onSelectProduct }: CatalogPageProps) {
  useDocumentTitle("Katalog — GoShop");
  const { products, phase, error, hasMore, loadMore, retry } = useProducts({
    limit: PAGE_SIZE,
  });
  return (
    <div className="catalog">
      <aside className="catalog__aside">
        <CategorySection />
      </aside>
      <Section title="Produk" className="catalog__products">
        {products.length > 0 && (
          <ProductGrid products={products} onSelectProduct={onSelectProduct} />
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
  );
}
