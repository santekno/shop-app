import type { Product } from "@goshop/shared";
import { ProductCard } from "./ProductCard.tsx";

interface ProductGridProps {
  products: readonly Product[];
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
export function ProductGrid({ products }: ProductGridProps) {
  return (
    // Two columns on a phone, three from sm, four from lg. Each item is a
    // flex box, so every card in a row stretches to the tallest.
    <ul className="product-grid grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.id} className="flex">
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
