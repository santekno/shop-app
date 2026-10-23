import { useId, useState } from "react";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { ProductImage } from "@/features/catalog/components/ProductImage.tsx";
import { QuantityStepper } from "./QuantityStepper.tsx";
import { VariantPicker } from "./VariantPicker.tsx";

interface ProductDetailProps {
  product: Product;
}

/**
 * A loaded product: photo, description, variants and quantity.
 *
 * It is rendered only once the product is there, so its state can start
 * from the product with a plain useState initial value; no effect copies
 * the product into state after it arrives.
 */
export function ProductDetail({ product }: ProductDetailProps) {
  useDocumentTitle(`${product.name} — GoShop`);
  const headingId = useId();
  const { variants } = product;
  // The first variant in stock, or the first one when all are sold out.
  // The contract promises at least one variant (minItems: 1).
  const [variantId, setVariantId] = useState(
    () => (variants.find((v) => v.stock > 0) ?? variants[0])?.id ?? "",
  );
  const variant = variants.find((v) => v.id === variantId);

  return (
    <Card as="article" className="product-detail" labelledBy={headingId}>
      <ProductImage name={product.name} />
      <div className="product-detail__info">
        <p className="muted">{product.category.name}</p>
        <h2 id={headingId}>{product.name}</h2>
        {variant !== undefined && (
          <p className="price price--large">{formatRupiah(variant.price)}</p>
        )}
        <p>{product.description}</p>

        <VariantPicker
          variants={variants}
          selectedId={variantId}
          onSelect={setVariantId}
        />

        {variant !== undefined &&
          (variant.stock > 0 ? (
            <QuantityStepper stock={variant.stock} />
          ) : (
            <p className="badge">Stok habis</p>
          ))}
      </div>
    </Card>
  );
}
