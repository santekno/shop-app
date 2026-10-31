import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { formatRupiah } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { ProductPhoto } from "./ProductPhoto";

interface ProductCardProps {
  product: Product;
  /** Called when the buyer taps the card (opens the product, artikel 08). */
  onPress: (product: Product) => void;
}

/**
 * One product in the catalog: photo, name, price, stock. The phone's
 * version of apps/web's ProductCard, built from the four core components:
 *
 * - `View`, the box (a `<div>`): it lays out its children and draws
 *   backgrounds and borders, but cannot hold text;
 * - `Text`, the only component that can hold a string (a bare string in a
 *   `View` is an error, not an anonymous text node);
 * - `Image`, a photo from a URL or a bundled file (ProductPhoto);
 * - `Pressable`, anything that reacts to a touch. There is no `onClick` and
 *   no `<button>`: `Pressable` reports the touch (onPress, onLongPress) and
 *   whether a finger is down (`pressed`), and the app draws the feedback.
 *
 * Styled with NativeWind (artikel 05): `className` takes the storefront's
 * Tailwind classes, compiled into React Native styles when the app is
 * built. Every colour comes with its `dark:` twin, applied when the device
 * is in dark mode. The StyleSheet version is in the README (artikel 04).
 *
 * Wrapped in memo, like the web card: a list that re-renders (a new page
 * arriving, artikel 06) leaves the cards whose product did not change.
 */
export const ProductCard = memo(function ProductCard({
  product,
  onPress,
}: ProductCardProps) {
  const { name, variants } = product;
  const { price_from: priceFrom, in_stock: inStock } = product;
  // price_from is the cheapest variant; "Mulai" says other variants cost more.
  const hasPriceRange = variants.some(
    (variant) => variant.price.amount !== priceFrom.amount,
  );
  const price = formatRupiah(priceFrom);

  return (
    <Pressable
      onPress={() => {
        onPress(product);
      }}
      // What TalkBack and VoiceOver announce. The card is one element: the
      // screen reader reads this label, not every Text inside, and says
      // "button" after it.
      accessibilityRole="button"
      accessibilityLabel={[
        name,
        hasPriceRange ? `mulai ${price}` : price,
        inStock ? null : "stok habis",
      ]
        .filter((part) => part !== null)
        .join(", ")}
      accessibilityHint="Membuka halaman produk"
      // active: is the pressed state (the web's :active): NativeWind
      // listens to the Pressable's press-in and press-out for it.
      // grow, not flex-1: flex-1 is a basis of 0%, and a list cell has no
      // height to grow into, so the cards collapsed to their padding when
      // FlatList laid out the rows again (README, artikel 06). grow starts
      // from the content and still fills a row's taller cell.
      className="grow gap-1 rounded-lg border border-border bg-card p-3 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark"
    >
      <ProductPhoto image={product.images[0]} />
      {/* numberOfLines cuts a long name after two lines with "…", what
          line-clamp does on the web. */}
      <Text
        numberOfLines={2}
        className="mt-1 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark"
      >
        {name}
      </Text>
      <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
        {/* Text inside Text is the one place styles are inherited: the
            inner Text keeps the outer's size and changes the weight and
            colour. */}
        {hasPriceRange && (
          <Text className="font-normal text-muted-foreground dark:text-muted-foreground-dark">
            Mulai{" "}
          </Text>
        )}
        {price}
      </Text>
      {!inStock && (
        <View className="self-start rounded bg-destructive px-2 py-0.5 dark:bg-destructive-dark">
          <Text className="font-sans text-xs font-semibold text-destructive-foreground dark:text-destructive-foreground-dark">
            Stok habis
          </Text>
        </View>
      )}
    </Pressable>
  );
});
