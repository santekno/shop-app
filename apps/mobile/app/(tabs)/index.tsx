// Beranda, at the route "/" (goshop:// as a deep link): the (tabs) group
// adds no segment. Until the catalog comes from the API (artikel 06), it
// shows sample products; it already carries the catalog's search and sort
// order as route parameters (/?q=kaos&urut=termurah), set by the search
// field and the sort sheet (app/filter.tsx).
//
// This tab has no navigation header (app/(tabs)/_layout.tsx): its own top
// bar holds the search field, so it keeps clear of the status bar and the
// notch itself, with the safe-area insets.
import { Link, router, useLocalSearchParams, useTheme } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Product } from "@goshop/shared";

import { Icon } from "@/components/Icon";
import { ProductGrid } from "@/features/catalog/components/ProductGrid";
import { SearchBar } from "@/features/catalog/components/SearchBar";
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { q, urut } = useLocalSearchParams<{ q?: string; urut?: string }>();
  const query = typeof q === "string" ? q : "";
  const sort = sortFromParam(urut);

  return (
    // The keyboard is drawn over the app. On iOS the window keeps its size,
    // so "padding" shrinks this screen by the part the keyboard covers and
    // the end of the list stays reachable. Android resizes the window
    // itself (softwareKeyboardLayoutMode "resize", Expo's default), so no
    // extra behaviour is needed there.
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.topBar,
          {
            // Below the status bar or the notch, whichever is taller.
            paddingTop: insets.top + 8,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[styles.brand, { color: colors.text }]}
        >
          GoShop
        </Text>
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            {/* A new key when the route's search changes (a deep link,
                for one) starts the field again from it. */}
            <SearchBar
              key={query}
              initialQuery={query}
              onSubmit={(text) => {
                // The search becomes part of the route, like ?q= on the
                // web: an empty search removes it.
                router.setParams({ q: text === "" ? undefined : text });
              }}
            />
          </View>
          {/* A modal route: the root stack presents /filter over the tabs.
              asChild hands the link's press to the Pressable, which can
              take a larger touch area than its 24-point icon. */}
          <Link
            href={{ pathname: "/filter", params: { urut: sort.param } }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Urutkan, saat ini ${sort.label}`}
              hitSlop={10}
            >
              <Icon name="urutkan" color={colors.primary} />
            </Pressable>
          </Link>
        </View>
      </View>
      {/* A View does not scroll: content taller than the screen is simply
          cut off. ScrollView scrolls, and renders every child at once,
          which is fine for six cards (artikel 06 and 07 compare it with
          FlatList). */}
      <ScrollView
        style={styles.list}
        // Dragging the list puts the keyboard away. iOS can follow the
        // finger ("interactive"); Android only knows "on-drag".
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        // A tap on a card works at the first touch; a tap on empty space
        // closes the keyboard.
        keyboardShouldPersistTaps="handled"
      >
        {/* The samples are neither searched nor sorted: artikel 06 sends
            q and urut to the API. */}
        <Text style={[styles.caption, { color: colors.text }]}>
          {query === ""
            ? "Contoh produk"
            : `Contoh produk, bukan hasil "${query}"`}
          {` · Urutan: ${sort.label}`}
        </Text>
        <ProductGrid products={SAMPLE_PRODUCTS} onPressProduct={openProduct} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: {
    fontSize: 22,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchField: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  caption: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
