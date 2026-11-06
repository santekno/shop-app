// Beranda, at the route "/" (goshop:// as a deep link): the (tabs) group
// adds no segment. The catalog from the API, narrowed and sorted by the
// route's parameters (/?kategori=kaos&q=polos&urut=termurah), which the
// Kategori tab, the search field and the filter sheet (FilterSheet) set.
//
// This tab has no navigation header (app/(tabs)/_layout.tsx): its own top
// bar holds the search field, so it keeps clear of the status bar and the
// notch itself, with the safe-area insets.
import { useQueryClient } from "@tanstack/react-query";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { router, useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/Icon";
import { categoriesQuery } from "@/features/catalog/api/queries";
import { readCatalogFilters } from "@/features/catalog/catalog-filters";
import {
  CATALOG_SIDE_PADDING,
  ProductList,
} from "@/features/catalog/components/ProductList";
import {
  countActiveFilters,
  FilterSheet,
} from "@/features/catalog/components/FilterSheet";
import { SearchBar } from "@/features/catalog/components/SearchBar";
import { DEFAULT_SORT, sortFromParam } from "@/features/catalog/sort-options";
import {
  bannersQuery,
  featuredProductsQuery,
} from "@/features/home/api/queries";
import { HomeSections } from "@/features/home/components/HomeSections";

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
  const sheetRef = useRef<BottomSheetModal>(null);
  // The category's name, if the Kategori tab has loaded the categories
  // (the ["categories"] query); the slug otherwise, as from a deep link.
  // A read of the cache, not a request: the name is a nicety, and the
  // list itself needs only the slug. A snapshot, too: getQueryData does
  // not subscribe, so a name that arrives later shows on Beranda's next
  // render (any change of its route does one), not the moment it lands.
  const categoryName =
    filters.category === undefined
      ? undefined
      : (queryClient
          .getQueryData(categoriesQuery().queryKey)
          ?.find((c) => c.slug === filters.category)?.name ?? filters.category);

  const activeFilters = countActiveFilters({
    category: filters.category,
    sort,
  });

  // The banners, categories and featured products are the shop window:
  // shown when nothing narrows the catalog. A search or a category is a
  // search for something, and the window would only push it down.
  const showSections =
    filters.q === undefined && filters.category === undefined;
  // Banners and the category row set the same ?kategori= the Kategori tab
  // does; setParams keeps the search and the sort.
  const openCategory = (slug: string) => {
    router.setParams({ kategori: slug });
  };

  // Pull to refresh refetches what is on screen and nothing else: the
  // catalog list (ProductList does that one) and, while the shop window
  // shows, its three queries. Hidden sections are not queried, and a
  // search or a category result is its own list. Exact keys, not
  // everything under ["products"]: that would also refetch every list the
  // buyer has visited since.
  const refreshSections = () =>
    Promise.allSettled(
      [
        bannersQuery().queryKey,
        categoriesQuery().queryKey,
        featuredProductsQuery().queryKey,
      ].map((queryKey) =>
        queryClient.refetchQueries({ queryKey, exact: true, type: "active" }),
      ),
    );

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
            {/* No key: the field keeps its focus and its text while the
                route's search follows it. A change that did not come from
                the field (a deep link, "Reset filter") starts it again. */}
            <SearchBar
              initialQuery={query}
              onSubmit={(text) => {
                // The search becomes part of the route, like ?q= on the
                // web: an empty search removes it. The field calls this
                // once the user pauses typing, not on every keystroke.
                router.setParams({ q: text === "" ? undefined : text });
              }}
            />
          </View>
          {/* Opens the filter sheet (FilterSheet), a bottom sheet over this
              screen, not a route. The badge counts the filters that differ
              from the default. The Pressable has its own role="button" and
              a label that says what is applied, since the icon alone says
              nothing to TalkBack or VoiceOver. */}
          <Pressable
            role="button"
            accessibilityLabel={`Filter dan urutan, saat ini ${sort.label}${
              categoryName === undefined ? "" : `, kategori ${categoryName}`
            }`}
            // 24 + 2 × 12 = 48 dp, Android's smallest touch target
            // (iOS asks for 44 pt), around a 24 dp icon.
            hitSlop={12}
            onPress={() => {
              sheetRef.current?.present();
            }}
          >
            <Icon
              name="filter"
              className="text-primary dark:text-primary-dark"
            />
            {activeFilters > 0 && (
              <View
                // Decorative: the label above already says what is applied.
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                className="absolute -right-2 -top-2 h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 dark:bg-primary-dark"
              >
                <Text className="font-sans text-[10px] font-bold text-primary-foreground dark:text-primary-foreground-dark">
                  {activeFilters}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      <ProductList
        filters={filters}
        // Clear everything that narrows the list; the empty state's way out.
        onReset={
          showSections
            ? undefined
            : () => {
                router.setParams({
                  q: undefined,
                  kategori: undefined,
                  urut: undefined,
                });
              }
        }
        refreshAlso={showSections ? refreshSections : undefined}
        header={
          showSections ? (
            <HomeSections
              onOpenCategory={openCategory}
              bleed={CATALOG_SIDE_PADDING}
            />
          ) : undefined
        }
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
      {/* Mounted here, not in the header: a modal sheet draws over the
          whole window, and the route stays Beranda's (?kategori=&urut=). */}
      <FilterSheet
        sheetRef={sheetRef}
        applied={{ category: filters.category, sort }}
        onApply={(choice) => {
          // Only what changed is written; an unchanged (default) value
          // leaves the route, so "/" stays "/". The search stays.
          router.setParams({
            kategori: choice.category,
            urut:
              choice.sort.value === DEFAULT_SORT.value
                ? undefined
                : choice.sort.param,
          });
        }}
      />
    </KeyboardAvoidingView>
  );
}
