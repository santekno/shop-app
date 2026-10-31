import { StyleSheet, View, useWindowDimensions } from "react-native";
import type { Product } from "@goshop/shared";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products: readonly Product[];
  onPressProduct: (product: Product) => void;
}

/** Space around the grid and between its cards, in dp. */
const PADDING = 16;
const GAP = 12;
/** Two cards per row on a phone; a wider screen (a tablet) gets more. */
const MIN_CARD_WIDTH = 160;

/**
 * The products as rows of cards, two on a phone, apps/web's
 * `grid grid-cols-2 gap-3`.
 *
 * React Native has no CSS Grid: flexbox is its only layout. A row that
 * wraps (`flexDirection: "row"`, `flexWrap: "wrap"`) with a `gap` makes the
 * grid, and each cell gets an exact width in dp. A width of "50%" would not
 * do: the gap is added on top of it, and the second card would wrap to the
 * next row. useWindowDimensions gives the screen's width in dp and
 * re-renders the grid when it changes (a rotation, a foldable unfolding).
 *
 * The products arrive as a plain array here and every card is rendered
 * at once; artikel 06 moves the list into a FlatList, which renders only
 * the rows on screen and lays out its columns with `numColumns`.
 */
export function ProductGrid({ products, onPressProduct }: ProductGridProps) {
  const { width } = useWindowDimensions();
  const columns = Math.max(
    2,
    Math.floor((width - 2 * PADDING + GAP) / (MIN_CARD_WIDTH + GAP)),
  );
  const cellWidth = (width - 2 * PADDING - (columns - 1) * GAP) / columns;

  return (
    <View style={styles.grid}>
      {products.map((product) => (
        // The cell carries the width, so the card does not need to know
        // how many columns there are.
        <View key={product.id} style={{ width: cellWidth }}>
          <ProductCard product={product} onPress={onPressProduct} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    // Lay the cells out left to right and start a new row when one is full.
    flexDirection: "row",
    flexWrap: "wrap",
    // Between cells, both ways; never around the outside, unlike margin.
    gap: GAP,
    padding: PADDING,
    // alignItems is "stretch" by default: every cell in a row is as tall as
    // the tallest, so the cards line up even when one name takes two lines.
  },
});
