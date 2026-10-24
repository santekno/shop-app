import { memo } from "react";
import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { productPath } from "@/features/product/paths.ts";
import { ProductImage } from "./ProductImage.tsx";

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

  return (
    <Card as="article" className="product-card">
      <ProductImage name={name} />
      <h3 className="product-card__name">
        {/* A link, because opening a product is going to another page:
            it has a real href, so it opens in a new tab, can be copied
            and shared, and is announced as a link. The router catches a
            plain click and renders the product route without a reload. */}
        <Link
          to={productPath(product.slug)}
          // useRouteFocus looks the link up by this attribute to give it
          // the focus back when the buyer returns from the product page.
          data-product-slug={product.slug}
        >
          {name}
        </Link>
      </h3>
      <p className="muted">{category.name}</p>
      <p className="price">
        {hasPriceRange && <span className="price__from">Mulai </span>}
        {formatRupiah(priceFrom)}
      </p>
      {!inStock && <p className="badge">Stok habis</p>}
    </Card>
  );
});
