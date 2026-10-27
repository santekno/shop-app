"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { isApiError } from "@goshop/shared";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { productQuery } from "../api/queries.ts";
import { navigationStateFor } from "@/lib/navigation-state.ts";
import { cameFromCatalog, productPath } from "../paths.ts";
import { ProductDetail } from "./ProductDetail.tsx";

/**
 * /produk/[slug]: one product (app/produk/[slug]/page.tsx renders it with
 * the slug from the URL).
 *
 * A client component: the variant picker, the quantity and "Tambah ke
 * keranjang" need state and events. The page around it is a server
 * component, and from artikel 09 it fetches the product on the server, so
 * the HTML already holds the product and this component starts with it in
 * the cache.
 */
export function ProductDetailPage({ slug }: { slug: string }) {
  const router = useRouter();
  // A product opened before comes from the cache at once (and is fetched
  // again in the background once it is older than the stale time); a new
  // slug is a new key, so the previous product never shows under it.
  const {
    data: product,
    status,
    error,
    isFetching,
    refetch,
  } = useQuery(productQuery(slug));

  // A product that is gone: Next.js' 404 page (app/produk/[slug]/
  // not-found.tsx), the same one an unknown URL gets. notFound() throws,
  // like a redirect, so nothing below runs.
  if (status === "error" && isApiError(error, "NOT_FOUND")) notFound();

  // Opened from a catalog card: the entry before this one is that list,
  // with the buyer's filters, so going back is better than a fresh "/".
  // Opened any other way (a shared link, a new tab), the link's href is
  // the way back. A Ctrl/Cmd/Shift-click keeps opening "/" in a new tab.
  const backToList = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cameFromCatalog(navigationStateFor(productPath(slug)))) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    if (event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.back();
  };

  return (
    <div className="product-page grid justify-items-start gap-4">
      <Link href="/" onClick={backToList}>
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
