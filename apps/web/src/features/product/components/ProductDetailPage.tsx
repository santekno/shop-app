import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { MouseEvent } from "react";
import { isApiError } from "@goshop/shared";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useProduct } from "../hooks/useProduct.ts";
import { cameFromCatalog } from "../paths.ts";
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

  // Opened from a catalog card: the entry before this one is that list,
  // with the buyer's filters, so going back is better than a fresh "/".
  // Opened any other way (a shared link, a new tab), the link's href is
  // the way back. A Ctrl/Cmd/Shift-click keeps opening "/" in a new tab.
  const location = useLocation();
  const navigate = useNavigate();
  const backToList = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cameFromCatalog(location.state)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    if (event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate(-1);
  };

  return (
    <div className="product-page">
      <Link to="/" onClick={backToList}>
        ← Kembali ke katalog
      </Link>

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
