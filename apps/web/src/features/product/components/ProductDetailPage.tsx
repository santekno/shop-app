import { Link, useParams } from "react-router";
import { isApiError } from "@goshop/shared";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useProduct } from "../hooks/useProduct.ts";
import { ProductDetail } from "./ProductDetail.tsx";

/**
 * /produk/:slug: one product, loaded by the slug in the URL.
 *
 * The URL is now the only input. In Bab 8 the slug arrived as a prop from
 * App's state, so a reload or a shared link always showed the catalog;
 * now /produk/kaos-polos-hitam opens this product directly (Caddy answers
 * index.html for every path, and the router picks the route).
 */
export function ProductDetailPage() {
  // useParams returns the route's parameters, already decoded. The type
  // says string | undefined because useParams cannot know which route a
  // component is rendered by; this one is only rendered by PRODUCT_ROUTE,
  // so `slug` is always there.
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
      {/* key: another product is another component, so the variant and
          quantity it keeps start again from the new product. */}
      {state.status === "success" && (
        <ProductDetail key={state.data.id} product={state.data} />
      )}
    </div>
  );
}
