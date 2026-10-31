import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
      // `style` may be a function of the press state: the web's :active,
      // written in JavaScript.
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <ProductPhoto image={product.images[0]} />
      {/* numberOfLines cuts a long name after two lines with "…", what
          line-clamp does on the web. */}
      <Text numberOfLines={2} style={styles.name}>
        {name}
      </Text>
      <Text style={styles.price}>
        {/* Text inside Text is the one place styles are inherited: the
            inner Text keeps the outer's size and changes the weight. */}
        {hasPriceRange && <Text style={styles.priceFrom}>Mulai </Text>}
        {price}
      </Text>
      {!inStock && (
        <View style={styles.soldOut}>
          <Text style={styles.soldOutText}>Stok habis</Text>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 160,
    gap: 4,
  },
  cardPressed: {
    opacity: 0.6,
  },
  name: {
    fontWeight: "600",
  },
  price: {
    fontWeight: "600",
  },
  priceFrom: {
    fontWeight: "400",
  },
  soldOut: {
    alignSelf: "flex-start",
    backgroundColor: "#b42318",
  },
  soldOutText: {
    color: "#ffffff",
  },
});
