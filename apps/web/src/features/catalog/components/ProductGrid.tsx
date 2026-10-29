import type { Product } from "@goshop/shared";
import { ProductCard } from "./ProductCard.tsx";

interface ProductGridProps {
  products: readonly Product[];
}

/**
 * Cards whose photo loads with the page: the first row on the widest
 * layout (four columns). They are on screen at once, so lazy-loading them
 * would only start them late; everything below waits until it nears the
 * screen (artikel 12).
 */
const EAGER_IMAGES = 4;

/**
 * The catalog's products as a responsive grid: one list item per product.
 *
 * `key` tells React which item is which between renders. It must be stable
 * and unique among siblings, so it is the product's id, not its index. An
 * index works only while items are only ever appended (as "load more"
 * does). A new filter or sort, or an item inserted or removed before
 * others, would hand one product's DOM (and state) to another; the id never
 * moves with the position. The index only decides how the photo loads.
 */
export function ProductGrid({ products }: ProductGridProps) {
  return (
    // Two columns on a phone, three from sm, four from lg. Each item is a
    // flex box, so every card in a row stretches to the tallest.
    <ul className="product-grid grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id} className="flex">
          <ProductCard
            product={product}
            imageLoading={index < EAGER_IMAGES ? "eager" : "lazy"}
          />
        </li>
      ))}
    </ul>
  );
}
