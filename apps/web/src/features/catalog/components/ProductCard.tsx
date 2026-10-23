import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { ProductImage } from "./ProductImage.tsx";

/**
 * A component's props are one object, typed like a Go struct parameter.
 * The caller writes them as attributes: <ProductCard product={product} />.
 */
interface ProductCardProps {
  product: Product;
}

/** One product in the catalog grid: photo, name, category, price, stock. */
export function ProductCard({ product }: ProductCardProps) {
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
      <h3 className="product-card__name">{name}</h3>
      <p className="muted">{category.name}</p>
      <p className="price">
        {hasPriceRange && <span className="price__from">Mulai </span>}
        {formatRupiah(priceFrom)}
      </p>
      {!inStock && <p className="badge">Stok habis</p>}
    </Card>
  );
}
