import { useEffect, useId, useRef, useState } from "react";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { ProductImage } from "@/features/catalog/components/ProductImage.tsx";
import { clampQuantity, maxQuantity } from "../quantity.ts";
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

  // After a navigation useRouteFocus focuses the page's <h1>, but a
  // product that was still loading had none yet, so <main> got the focus.
  // Now that the heading is here, hand the focus on to it. Only from
  // <main>: a buyer who already moved on (or a fresh page load, where the
  // focus is on <body>) keeps it where it is.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (document.activeElement?.tagName === "MAIN") {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, []);
  const { variants } = product;
  // The first variant in stock, or the first one when all are sold out.
  // The contract promises at least one variant (minItems: 1).
  const [variantId, setVariantId] = useState(
    () => (variants.find((v) => v.stock > 0) ?? variants[0])?.id ?? "",
  );
  const variant = variants.find((v) => v.id === variantId);
  const stock = variant?.stock ?? 0;
  // Lifted from QuantityStepper: this component needs it for the subtotal.
  // It always holds a quantity the variant allows: 1 up to its stock (and
  // 99), or 0 when it is sold out.
  const [quantity, setQuantity] = useState(() => clampQuantity(1, stock));

  // Switching variant caps the quantity at the new variant's stock, here in
  // the handler that makes the change. The stored quantity and the one on
  // screen are then always the same number: switching back shows what the
  // buyer last saw, not an older value that was only hidden by a cap.
  const selectVariant = (id: string) => {
    setVariantId(id);
    const next = variants.find((v) => v.id === id);
    setQuantity((q) => clampQuantity(q, next?.stock ?? 0));
  };

  return (
    <Card as="article" className="product-detail" labelledBy={headingId}>
      <ProductImage name={product.name} />
      <div className="product-detail__info">
        <p className="muted">{product.category.name}</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {product.name}
        </h1>
        {variant !== undefined && (
          <p className="price price--large">{formatRupiah(variant.price)}</p>
        )}
        <p>{product.description}</p>

        <VariantPicker
          variants={variants}
          selectedId={variantId}
          onSelect={selectVariant}
        />

        {variant !== undefined &&
          (quantity > 0 ? (
            <>
              <QuantityStepper
                value={quantity}
                max={maxQuantity(stock)}
                onChange={setQuantity}
              />
              <p>
                Subtotal:{" "}
                <strong>
                  {formatRupiah({
                    amount: variant.price.amount * quantity,
                    currency: variant.price.currency,
                  })}
                </strong>
              </p>
            </>
          ) : (
            <p className="badge">Stok habis</p>
          ))}
      </div>
    </Card>
  );
}
