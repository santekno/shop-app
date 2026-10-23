import { useEffect, useState } from "react";
import { isApiError, listProducts } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { api } from "@/lib/api.ts";
import type { AsyncState } from "@/lib/async-state.ts";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { CategorySection } from "./CategorySection.tsx";
import { ProductGrid } from "./ProductGrid.tsx";

/** Products per page: a grid of 3 or 4 columns fills evenly. */
const PAGE_SIZE = 12;

/** The storefront's home: categories beside the newest products. */
export function CatalogPage() {
  useDocumentTitle("Katalog — GoShop");
  const [state, setState] = useState<AsyncState<Product[]>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Load the first page, and again after "Coba lagi". The cleanup aborts
  // the request when the page goes away or before the next attempt.
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const page = await listProducts(
          api,
          { limit: PAGE_SIZE },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setState({ status: "success", data: page.data });
      } catch (error) {
        if (controller.signal.aborted || isApiError(error, "ABORTED")) return;
        setState({ status: "error", error });
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [attempt]);

  if (selectedSlug !== null) {
    return (
      <ProductDetailPage
        slug={selectedSlug}
        onBack={() => {
          setSelectedSlug(null);
        }}
      />
    );
  }

  return (
    <div className="catalog">
      <aside className="catalog__aside">
        <CategorySection />
      </aside>
      <Section title="Produk" className="catalog__products">
        {state.status === "loading" && (
          <LoadingState>Memuat produk…</LoadingState>
        )}
        {state.status === "error" && (
          <ErrorState
            error={state.error}
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {state.status === "success" &&
          (state.data.length === 0 ? (
            <EmptyState>Belum ada produk.</EmptyState>
          ) : (
            <ProductGrid
              products={state.data}
              onSelectProduct={setSelectedSlug}
            />
          ))}
      </Section>
    </div>
  );
}
