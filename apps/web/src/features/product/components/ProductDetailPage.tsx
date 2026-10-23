import { useEffect, useState } from "react";
import { getProduct, isApiError } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { api } from "@/lib/api.ts";
import type { AsyncState } from "@/lib/async-state.ts";
import { ProductDetail } from "./ProductDetail.tsx";

interface ProductDetailPageProps {
  slug: string;
  onBack: () => void;
}

/** One product, loaded by its slug, with a way back to the catalog. */
export function ProductDetailPage({ slug, onBack }: ProductDetailPageProps) {
  const [state, setState] = useState<AsyncState<Product>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const product = await getProduct(api, slug, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ status: "success", data: product });
      } catch (error) {
        if (controller.signal.aborted || isApiError(error, "ABORTED")) return;
        setState({ status: "error", error });
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  return (
    <div className="product-page">
      {/* autoFocus moves the keyboard focus here when the page opens, so a
          keyboard user is not left on the card that just disappeared. */}
      <button type="button" className="link-button" onClick={onBack} autoFocus>
        ← Kembali ke katalog
      </button>

      {state.status === "loading" && (
        <LoadingState>Memuat produk…</LoadingState>
      )}
      {state.status === "error" &&
        (isApiError(state.error, "NOT_FOUND") ? (
          <EmptyState>Produk tidak ditemukan.</EmptyState>
        ) : (
          <ErrorState
            error={state.error}
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          />
        ))}
      {state.status === "success" && <ProductDetail product={state.data} />}
    </div>
  );
}
