// Beranda, at the route "/" (goshop:// as a deep link): the (tabs) group
// adds no segment. Until the catalog comes from the API (artikel 06), it
// shows sample products; it already carries the catalog's sort order as a
// route parameter (/?urut=termurah), set by the sort sheet (app/filter.tsx).
import { Link, router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import type { Product } from "@goshop/shared";

import { Icon } from "@/components/Icon";
import { ProductGrid } from "@/features/catalog/components/ProductGrid";
import { SAMPLE_PRODUCTS } from "@/features/catalog/fixtures";
import { sortFromParam } from "@/features/catalog/sort-options";

// A typed href: with typed routes on, a pathname that is not a route, or a
// missing slug, is a compile error. The detail screen is pushed on the root
// stack, above the tab bar.
const openProduct = (product: Product) => {
  router.push({
    pathname: "/produk/[slug]",
    params: { slug: product.slug },
  });
};

export default function HomeScreen() {
  const { urut } = useLocalSearchParams<{ urut?: string }>();
  const sort = sortFromParam(urut);

  return (
    // A View does not scroll: content taller than the screen is simply cut
    // off. ScrollView scrolls, and renders every child at once, which is
    // fine for six cards (artikel 06 and 07 compare it with FlatList).
    <ScrollView className="flex-1 bg-background dark:bg-background-dark">
      {/* A modal route: the root stack presents /filter over the tabs. */}
      <Link
        href={{ pathname: "/filter", params: { urut: sort.param } }}
        accessibilityLabel={`Urutkan, saat ini ${sort.label}`}
        style={styles.link}
      >
        <Icon name="urutkan" color="#2563eb" size={16} /> Urutkan: {sort.label}
      </Link>
      <ProductGrid products={SAMPLE_PRODUCTS} onPressProduct={openProduct} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  link: {
    fontSize: 16,
    color: "#2563eb",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
