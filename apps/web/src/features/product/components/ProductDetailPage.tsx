import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { MouseEvent } from "react";
import { isApiError } from "@goshop/shared";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { productQuery } from "../api/queries.ts";
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
  // A product opened before comes from the cache at once (and is fetched
  // again in the background once it is older than the stale time); a new
  // slug is a new key, so the previous product never shows under it.
  //
  // throwOnError: a NOT_FOUND is thrown during render instead of returned,
  // so the route's error boundary (RouteErrorPage) shows the 404 page, the
  // same one an unknown URL gets. Other errors stay here, with a retry.
  const {
    data: product,
    status,
    error,
    isFetching,
    refetch,
  } = useQuery({
    ...productQuery(slug),
    throwOnError: (queryError) => isApiError(queryError, "NOT_FOUND"),
  });

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

      {(status === "pending" || (status === "error" && isFetching)) && (
        <LoadingState>Memuat produk…</LoadingState>
      )}
      {status === "error" && !isFetching && (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      )}
      {/* key: another product is another component, so the variant and
          quantity it keeps start again from the new product. */}
      {status === "success" && (
        <ProductDetail key={product.id} product={product} />
      )}
    </div>
  );
}
