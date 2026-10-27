import { memo } from "react";
import Link from "next/link";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { FROM_CATALOG, productPath } from "@/features/product/paths.ts";
import { setNavigationState } from "@/lib/navigation-state.ts";
import { ProductImage } from "./ProductImage.tsx";
import { Badge } from "@/components/ui/Badge.tsx";

/**
 * A component's props are one object, typed like a Go struct parameter.
 * The caller writes them as attributes: <ProductCard product={product} />.
 */
interface ProductCardProps {
  product: Product;
}

/**
 * One product in the catalog grid: photo, name, category, price, stock.
 *
 * Wrapped in memo: React skips rendering a card again when its props are
 * the same objects as last time. "Muat lebih banyak" re-renders the grid
 * with 12 more products; with memo, the cards already on screen are left
 * alone. It works because `product` keeps its identity: the list appends
 * pages without copying the products already loaded. (In Bab 8 the card
 * also took an onSelect callback, which App had to keep stable with
 * useCallback; a link needs no callback at all.)
 */
export const ProductCard = memo(function ProductCard({
  product,
}: ProductCardProps) {
  // Destructuring renames the API's snake_case fields to camelCase locals.
  const { name, category, variants } = product;
  const { price_from: priceFrom, in_stock: inStock } = product;
  // price_from is the cheapest variant; "Mulai" says other sizes cost more.
  const hasPriceRange = variants.some(
    (variant) => variant.price.amount !== priceFrom.amount,
  );
  const href = productPath(product.slug);

  return (
    <Card as="article" className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
      <ProductImage name={name} />
      {/* product-card__name, like a few other names below, styles
          nothing: it stays as a stable hook for the end-to-end tests. */}
      <h3 className="product-card__name mt-2 text-sm font-semibold sm:text-base">
        {/* A link, because opening a product is going to another page:
            it has a real href, so it opens in a new tab, can be copied
            and shared, and is announced as a link. The router catches a
            plain click and renders the product route without a reload.
            Next.js prefetches the page when the link scrolls into view
            (in a production build), the job Bab 9's usePrefetchProduct
            did on hover. The click leaves FROM_CATALOG for the product
            page, which React Router carried as the link's `state`. */}
        <Link
          href={href}
          className="no-underline hover:underline"
          onClick={(event) => {
            // Only a plain click stays in this tab; a new tab has no list
            // behind it to go back to.
            if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
            if (event.shiftKey || event.altKey) return;
            setNavigationState(href, FROM_CATALOG);
          }}
          // useRouteFocus looks the link up by this attribute to give it
          // the focus back when the buyer returns from the product page.
          data-product-slug={product.slug}
        >
          {name}
        </Link>
      </h3>
      <p className="text-muted-foreground text-sm">{category.name}</p>
      <p className="price font-semibold">
        {hasPriceRange && (
          <span className="price__from font-normal text-muted-foreground">
            Mulai{" "}
          </span>
        )}
        {formatRupiah(priceFrom)}
      </p>
      {!inStock && (
        <Badge variant="destructive" className="badge">
          Stok habis
        </Badge>
      )}
    </Card>
  );
});
