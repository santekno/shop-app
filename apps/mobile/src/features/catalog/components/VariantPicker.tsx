import { Pressable, Text, View } from "react-native";
import { formatRupiah } from "@goshop/shared";
import type { ProductVariant } from "@goshop/shared";

import { Icon } from "@/components/Icon";
import { isAvailable } from "../variants";

interface VariantPickerProps {
  variants: readonly ProductVariant[];
  /** The variant on screen (selectedVariant), if any can be bought. */
  selectedId: string | undefined;
  onSelect: (variant: ProductVariant) => void;
}

/**
 * The variants as a group of options, the phone's radio buttons: exactly
 * one is chosen, and choosing another replaces it. Each option says what
 * the buyer needs to decide: the name, its price, and "Habis" when it
 * cannot be bought.
 *
 * Accessibility: the group is a `radiogroup` and each option a `radio`
 * with `checked` and `disabled` in its state, so TalkBack and VoiceOver
 * say "M, Rp 89.000, radio button, selected" or "XL, stok habis, radio
 * button, dimmed". The selected option is also marked with a check and a
 * heavier border, so the choice is not carried by colour alone.
 *
 * A sold-out variant stays visible (the buyer learns the size exists) but
 * does nothing when pressed. 48 dp tall, Android's smallest touch target.
 */
export function VariantPicker({
  variants,
  selectedId,
  onSelect,
}: VariantPickerProps) {
  if (variants.length === 0) return null;
  return (
    <View className="gap-2">
      <Text
        accessibilityRole="header"
        className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark"
      >
        Pilih varian
      </Text>
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {variants.map((variant) => {
          const available = isAvailable(variant);
          const selected = variant.id === selectedId;
          const price = formatRupiah(variant.price);
          return (
            <Pressable
              key={variant.id}
              role="radio"
              accessibilityLabel={`${variant.name}, ${price}${available ? "" : ", stok habis"}`}
              accessibilityState={{
                checked: selected,
                disabled: !available,
              }}
              disabled={!available}
              onPress={() => {
                onSelect(variant);
              }}
              className={`min-h-12 min-w-20 flex-row items-center justify-center gap-1.5 rounded-md border px-4 py-2 ${
                selected
                  ? "border-2 border-primary bg-accent dark:border-primary-dark dark:bg-accent-dark"
                  : "border-border bg-card active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark"
              } ${available ? "" : "opacity-50"}`}
            >
              {selected && (
                <Icon
                  name="terpilih"
                  size={16}
                  filled
                  className="text-primary dark:text-primary-dark"
                />
              )}
              <View className="items-center">
                <Text
                  className={`font-sans text-base font-semibold text-foreground dark:text-foreground-dark ${
                    available ? "" : "line-through"
                  }`}
                >
                  {variant.name}
                </Text>
                <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">
                  {available ? price : "Habis"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
