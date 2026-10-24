import { Link, useParams } from "react-router";
import { isApiError } from "@goshop/shared";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useProduct } from "../hooks/useProduct.ts";
import { ProductDetail } from "./ProductDetail.tsx";

/** /produk/:slug: one product, loaded by the slug in the URL. */
export function ProductDetailPage() {
  // The route is "produk/:slug", so the router always fills `slug` here;
  // the type says string | undefined because useParams cannot know which
  // route a component is rendered by.
  const { slug = "" } = useParams<"slug">();
  const { state, retry } = useProduct(slug);

  return (
    <div className="product-page">
      <Link to="/">← Kembali ke katalog</Link>

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
