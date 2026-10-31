// Beranda, at the route "/" (goshop:// as a deep link): the (tabs) group
// adds no segment. The catalog from the API, narrowed and sorted by the
// route's parameters (/?kategori=kaos&q=polos&urut=termurah), which the
// Kategori tab, the search field and the sort sheet (app/filter.tsx) set.
//
// This tab has no navigation header (app/(tabs)/_layout.tsx): its own top
// bar holds the search field, so it keeps clear of the status bar and the
// notch itself, with the safe-area insets.
import { useQueryClient } from "@tanstack/react-query";
import { Link, router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { categoriesQuery } from "@/features/catalog/api/queries";
import { readCatalogFilters } from "@/features/catalog/catalog-filters";
import { ProductList } from "@/features/catalog/components/ProductList";
import { SearchBar } from "@/features/catalog/components/SearchBar";
import { sortFromParam } from "@/features/catalog/sort-options";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { kategori, q, urut } = useLocalSearchParams<{
    kategori?: string;
    q?: string;
    urut?: string;
  }>();
  // The route is the state, as the query string is on the web: a deep
  // link, the Kategori tab, the sort sheet and the search field all change
  // it, and the list follows. The filters are checked here, not trusted.
  const filters = readCatalogFilters({ kategori, q, urut });
  const sort = sortFromParam(urut);
  const query = filters.q ?? "";
  // The category's name, if the Kategori tab has loaded the categories
  // (the ["categories"] query); the slug otherwise, as from a deep link.
  // A read of the cache, not a request: the name is a nicety, and the
  // list itself needs only the slug.
  const categoryName =
    filters.category === undefined
      ? undefined
      : (queryClient
          .getQueryData(categoriesQuery().queryKey)
          ?.find((c) => c.slug === filters.category)?.name ?? filters.category);

  return (
    // The keyboard is drawn over the app, and the window keeps its size on
    // both platforms: iOS never resizes it, and Android does not either
    // once the app is drawn edge to edge (always, in Expo SDK 58), even
    // with softwareKeyboardLayoutMode "resize". "padding" shrinks this
    // screen by the part the keyboard covers, so the list and its messages
    // end above it. (Measured on the Android emulator: no behaviour and
    // "height" both left the end of the list under the keyboard.)
    <KeyboardAvoidingView
      behavior="padding"
      className="flex-1 bg-background dark:bg-background-dark"
    >
      <View
        // The insets are numbers measured on this device while the app
        // runs, so they go in `style`; everything known in advance is a
        // class. Below the status bar or the notch, whichever is taller.
        style={{
          paddingTop: insets.top + 8,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        }}
        className="gap-2 border-b-hairline border-border bg-card pb-3 dark:border-border-dark dark:bg-card-dark"
      >
        <Text
          accessibilityRole="header"
          className="font-sans text-[22px] font-bold text-foreground dark:text-foreground-dark"
        >
          GoShop
        </Text>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
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
              take a larger touch area than its 24-point icon. It also
              hands it role="link", and React Native ranks `role` above
              accessibilityRole: without its own role="button" (the
              child's props win over the link's), TalkBack and VoiceOver
              would call this button, which opens a sheet, a "link". */}
          <Link
            // The sheet gets every filter, not only the order, and hands
            // them back with the new order: returning to "/" replaces the
            // route's parameters, and the category and search must stay.
            href={{
              pathname: "/filter",
              params: {
                kategori: filters.category,
                q: filters.q,
                urut: sort.param,
              },
            }}
            asChild
          >
            <Pressable
              role="button"
              accessibilityLabel={`Urutkan, saat ini ${sort.label}`}
              // 24 + 2 × 12 = 48 dp, Android's smallest touch target
              // (iOS asks for 44 pt), around a 24 dp icon.
              hitSlop={12}
            >
              <Icon
                name="urutkan"
                className="text-primary dark:text-primary-dark"
              />
            </Pressable>
          </Link>
        </View>
      </View>
      <ProductList
        filters={filters}
        category={
          categoryName === undefined
            ? undefined
            : {
                name: categoryName,
                onClear: () => {
                  router.setParams({ kategori: undefined });
                },
              }
        }
        caption={
          query === ""
            ? `Semua produk · ${sort.label}`
            : `Hasil pencarian "${query}" · ${sort.label}`
        }
      />
    </KeyboardAvoidingView>
  );
}
