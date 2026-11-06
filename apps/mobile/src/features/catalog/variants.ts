// Which variant of a product the buyer is looking at, and how to word it.
// Pure functions, no React: the screen holds only the id the buyer tapped.
import { formatRupiah } from "@goshop/shared";
import type { Product, ProductVariant } from "@goshop/shared";

/** At or below this many units the screen says "Stok tinggal N". */
export const LOW_STOCK_THRESHOLD = 5;

/** A variant can be bought only while it has stock. */
export const isAvailable = (variant: ProductVariant): boolean =>
  variant.stock > 0;

/**
 * The variant to show: the one the buyer chose if it can still be bought,
 * else the first that can. `chosenId` may be undefined (nothing tapped
 * yet), or name a variant that has since sold out or vanished (the product
 * was refetched): both fall back instead of showing a stale choice.
 * Undefined when every variant is sold out, or the product has none.
 */
export const selectedVariant = (
  product: Pick<Product, "variants">,
  chosenId: string | undefined,
): ProductVariant | undefined =>
  product.variants.find((v) => v.id === chosenId && isAvailable(v)) ??
  product.variants.find(isAvailable);

/** The price line: the variant's, else the cheapest ("Mulai") of the product. */
export const priceLabel = (
  product: Pick<Product, "price_from" | "variants">,
  variant: ProductVariant | undefined,
): string => {
  if (variant !== undefined) return formatRupiah(variant.price);
  const hasRange = product.variants.some(
    (v) => v.price.amount !== product.price_from.amount,
  );
  const price = formatRupiah(product.price_from);
  return hasRange ? `Mulai ${price}` : price;
};

/** "Stok habis", "Stok tinggal 3", or "Stok tersedia". */
export const stockLabel = (variant: ProductVariant | undefined): string => {
  if (variant === undefined || !isAvailable(variant)) return "Stok habis";
  return variant.stock <= LOW_STOCK_THRESHOLD
    ? `Stok tinggal ${variant.stock}`
    : "Stok tersedia";
};
