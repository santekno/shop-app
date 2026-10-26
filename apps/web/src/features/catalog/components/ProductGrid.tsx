import type { Product } from "@goshop/shared";
import { ProductCard } from "./ProductCard.tsx";

interface ProductGridProps {
  products: readonly Product[];
  onSelectProduct: (slug: string) => void;
}

/**
 * The catalog's products as a responsive grid: one list item per product.
 *
 * `key` tells React which item is which between renders. It must be stable
 * and unique among siblings, so it is the product's id, not its index. An
 * index works only while items are only ever appended (as "load more"
 * does). A new filter or sort, or an item inserted or removed before
 * others, would hand one product's DOM (and state) to another; the id never
 * moves with the position.
 */
export function ProductGrid({ products, onSelectProduct }: ProductGridProps) {
  return (
    <ul className="product-grid">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} onSelect={onSelectProduct} />
        </li>
      ))}
    </ul>
  );
}
