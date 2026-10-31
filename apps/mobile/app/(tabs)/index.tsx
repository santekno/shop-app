// Beranda, at the route "/" (goshop:// as a deep link): the (tabs) group
// adds no segment. Until the catalog comes from the API (artikel 06), it
// shows sample products.
import { router } from "expo-router";
import { ScrollView } from "react-native";
import type { Product } from "@goshop/shared";
import { ProductGrid } from "@/features/catalog/components/ProductGrid";
import { SAMPLE_PRODUCTS } from "@/features/catalog/fixtures";

// A typed href: with typed routes on, a pathname that is not a route, or a
// missing slug, is a compile error.
const openProduct = (product: Product) => {
  router.push({
    pathname: "/produk/[slug]",
    params: { slug: product.slug },
  });
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
