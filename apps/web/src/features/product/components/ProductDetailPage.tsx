import { isApiError } from "@goshop/shared";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useProduct } from "../hooks/useProduct.ts";
import { ProductDetail } from "./ProductDetail.tsx";

interface ProductDetailPageProps {
  slug: string;
  onBack: () => void;
}

/** One product, loaded by its slug, with a way back to the catalog. */
export function ProductDetailPage({ slug, onBack }: ProductDetailPageProps) {
  const { state, retry } = useProduct(slug);

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
          <ErrorState error={state.error} onRetry={retry} />
        ))}
      {state.status === "success" && <ProductDetail product={state.data} />}
    </div>
  );
}
