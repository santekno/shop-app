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
            inner Text keeps the outer's size and changes the weight and
            colour. */}
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

// GoShop's colours, the light values of apps/web/src/index.css's tokens
// (the same roles: card, border, muted-foreground …). A StyleSheet cannot
// read a CSS variable or a media query, so dark mode would need these in
// two sets chosen with useColorScheme(); artikel 05 does it with NativeWind.
const colors = {
  card: "#ffffff",
  cardPressed: "#eef1f4", // --accent
  foreground: "#1f2328",
  mutedForeground: "#59636e",
  border: "#d1d9e0",
  destructive: "#b42318",
  destructiveForeground: "#ffffff",
};

// Every number is in density-independent pixels (dp on Android, points on
// iOS): 16 is the same physical size on a 1× and a 3× screen. There are no
// units to write, and no rem: a size never follows a parent's font size.
//
// Nothing cascades either. A style applies to the one component it is
// given to; the Text below does not inherit `card`'s colour, so each Text
// sets its own. (Text inside Text is the exception: `priceFrom` inherits
// `price`'s size and changes only the weight and the colour.)
const styles = StyleSheet.create({
  card: {
    // Fill the grid cell (ProductGrid sets its width) and, because every
    // cell in a row is stretched to the tallest, its height too.
    flex: 1,
    // flexDirection is "column" by default in React Native (the web's is
    // "row"): photo, name, price and badge stack top to bottom.
    gap: 4,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cardPressed: {
    backgroundColor: colors.cardPressed,
  },
  name: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: colors.foreground,
  },
  price: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  priceFrom: {
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  soldOut: {
    // A column stretches its children across its width (alignItems:
    // "stretch"); this one keeps the badge as wide as its text.
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.destructive,
  },
  soldOutText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.destructiveForeground,
  },
});
