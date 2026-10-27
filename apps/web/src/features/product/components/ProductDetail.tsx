import { useId, useState } from "react";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";
import { AddToCart } from "@/features/cart/components/AddToCart.tsx";
import { ProductImage } from "@/features/catalog/components/ProductImage.tsx";
import { clampQuantity, maxQuantity } from "../quantity.ts";
import { QuantityStepper } from "./QuantityStepper.tsx";
import { VariantPicker } from "./VariantPicker.tsx";
import { Badge } from "@/components/ui/Badge.tsx";

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

  // The heading arrives with the product, after the navigation.
  const headingRef = useLateHeadingFocus();
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
    // Stacked on a phone; photo and details side by side from md up.
    <Card
      as="article"
      className="grid w-full gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      labelledBy={headingId}
    >
      <ProductImage name={product.name} />
      <div className="grid content-start gap-3">
        <p className="text-muted-foreground">{product.category.name}</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {product.name}
        </h1>
        {variant !== undefined && (
          <p className="price price--large text-2xl font-semibold">
            {formatRupiah(variant.price)}
          </p>
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
              <AddToCart
                variantId={variant.id}
                unitPrice={variant.price}
                quantity={quantity}
              />
            </>
          ) : (
            <Badge variant="destructive" className="badge">
              Stok habis
            </Badge>
          ))}
      </div>
    </Card>
  );
}
