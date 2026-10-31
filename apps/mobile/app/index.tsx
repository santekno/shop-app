// The first screen, at the route "/" (goshop:// as a deep link). Until the
// catalog comes from the API (artikel 06), it shows sample products.
import { Alert, ScrollView, StyleSheet } from "react-native";
import type { Product } from "@goshop/shared";
import { ProductCard } from "@/features/catalog/components/ProductCard";
import { SAMPLE_PRODUCTS } from "@/features/catalog/fixtures";

// The product screen arrives with Expo Router's dynamic routes (artikel 08);
// until then a tap only proves the card reports it.
const openProduct = (product: Product) => {
  Alert.alert(product.name, "Halaman produk segera hadir.");
};

export default function HomeScreen() {
  return (
    // A View does not scroll: content taller than the screen is simply cut
    // off. ScrollView scrolls, and renders every child at once, which is
    // fine for six cards (artikel 06 and 07 compare it with FlatList).
    <ScrollView contentContainerStyle={styles.content}>
      {SAMPLE_PRODUCTS.map((product) => (
        <ProductCard key={product.id} product={product} onPress={openProduct} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    gap: 24,
    padding: 16,
  },
});
