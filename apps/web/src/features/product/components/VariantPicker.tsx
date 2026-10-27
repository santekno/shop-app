import { useId } from "react";
import type { ChangeEvent } from "react";
import { formatRupiah } from "@goshop/shared";
import type { ProductVariant } from "@goshop/shared";

interface VariantPickerProps {
  variants: readonly ProductVariant[];
  /** The id of the variant that is chosen now. */
  selectedId: string;
  /** Called with a variant's id when the buyer picks it. */
  onSelect: (variantId: string) => void;
}

/**
 * Radio buttons for a product's variants (sizes, colours), each with its
 * price and stock. A controlled input: `checked` comes from props, and a
 * change is reported through onSelect instead of being kept here.
 */
export function VariantPicker({
  variants,
  selectedId,
  onSelect,
}: VariantPickerProps) {
  // One `name` per picker makes its radios a group: choosing one unchecks
  // the others, and the arrow keys move between them.
  const groupName = useId();

  // React passes a typed event; currentTarget is the <input> the handler is
  // attached to, so .value is a string without a cast.
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelect(event.currentTarget.value);
  };

  return (
    // variant-picker and its __name: hooks for the tests, not styles.
    <fieldset className="variant-picker grid gap-1.5 rounded-md border border-border px-4 py-3">
      <legend className="px-1 font-semibold">Pilih varian</legend>
      {variants.map((variant) => (
        <label
          key={variant.id}
          className="flex cursor-pointer items-center gap-2"
        >
          <input
            // accent-color: the browser's own radio, in the brand colour.
            className="accent-primary"
            type="radio"
            name={groupName}
            value={variant.id}
            checked={variant.id === selectedId}
            onChange={handleChange}
          />
          <span className="variant-picker__name font-semibold">
            {variant.name}
          </span>
          <span className="text-muted-foreground">
            {formatRupiah(variant.price)}
            {variant.stock === 0 ? " · stok habis" : ` · stok ${variant.stock}`}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
