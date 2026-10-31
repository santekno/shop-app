// The first screen, at the route "/" (goshop:// as a deep link). Until the
// catalog comes from the API (artikel 06), it shows sample products.
import { Alert, ScrollView } from "react-native";
import type { Product } from "@goshop/shared";
import { ProductGrid } from "@/features/catalog/components/ProductGrid";
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
    <ScrollView className="flex-1 bg-background dark:bg-background-dark">
      <ProductGrid products={SAMPLE_PRODUCTS} onPressProduct={openProduct} />
    </ScrollView>
  );
}
