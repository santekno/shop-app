import { router, useTheme } from "expo-router";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { isApiError } from "@goshop/shared";
import type { Product } from "@goshop/shared";

import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StatusMessage";
import type { ProductListFilters } from "../api/products";
import { useProductList } from "../hooks/useProductList";
import { ProductCard } from "./ProductCard";
import { ProductListFooter } from "./ProductListFooter";

/** Two cards per row: the app is phone-only (supportsTablet is false). */
const COLUMNS = 2;

// A typed href: with typed routes on, a pathname that is not a route, or a
// missing slug, is a compile error. The detail screen is pushed on the root
// stack, above the tab bar.
const openProduct = (product: Product) => {
  router.push({ pathname: "/produk/[slug]", params: { slug: product.slug } });
};

// One cell: half the row's width, with 6 dp of padding all round. Two
// cells side by side put 12 dp between their cards, and the list's own
// 10 dp of side padding makes 16 dp at the screen's edges. A wrapping row
// with `gap` (ProductGrid before this article) has no place here: FlatList
// builds each row itself, a View with flexDirection "row" per row.
//
// A function outside the component, like openProduct: FlatList re-renders
// a row when renderItem changes, and memo(ProductCard) skips a card only
// when its props are the same functions as before.
const renderProduct: ListRenderItem<Product> = ({ item }) => (
  <View className="w-1/2 p-1.5">
    <ProductCard product={item} onPress={openProduct} />
  </View>
);

const productKey = (product: Product) => product.id;

interface ProductListProps {
  filters: ProductListFilters;
  /** One line above the first row: what is shown, in what order. */
  caption: string;
  /**
   * The category the list is narrowed to (filters.category), by its name
   * when known, and how to go back to every product.
   */
  category?: { name: string; onClear: () => void } | undefined;
}

/**
 * The catalog: GET /v1/products for `filters`, two cards per row, the next
 * page loaded as the buyer nears the end, pulled down to refresh.
 *
 * A FlatList, not a ScrollView with every card in it. A ScrollView mounts
 * all its children at once and keeps them: fine for six sample cards,
 * not for a catalog that grows by twenty per page, where each card is a
 * real native view with an image in memory. FlatList (a VirtualizedList)
 * renders the rows near the screen (`windowSize`: about ten screens'
 * worth) and replaces the rest with empty space of the measured height,
 * so the memory used stays the same however far the buyer scrolls.
 */
export function ProductList({ filters, caption, category }: ProductListProps) {
  const { colors } = useTheme();
  const {
    data,
    products,
    status,
    fetchStatus,
    error,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetchError,
    hasNextPage,
    fetchNextPage,
    refetch,
    refresh,
    isRefreshing,
  } = useProductList(filters);

  // Not while a request runs: fetchNextPage would cancel a background
  // refetch and start over. Not after a failed page: onEndReached fires
  // again as soon as the list moves, and loading by itself would retry in
  // a loop; the footer's "Coba lagi" does it.
  const loadMore = () => {
    if (hasNextPage && !isFetching && !isFetchNextPageError) {
      void fetchNextPage();
    }
  };

  // What the list shows when it has no rows. `data` decides, not `status`:
  // a list that has never loaded is loading, waiting for a network, or
  // failed; a list that has loaded and is empty matched no product.
  const empty =
    data === undefined ? (
      // A slug that looks right but names no category (a stale deep
      // link): say so, instead of a retry that would fail the same way.
      isApiError(error, "UNKNOWN_CATEGORY") && category !== undefined ? (
        <View className="items-center">
          <EmptyState message="Kategori ini tidak ada." />
          <Pressable
            accessibilityRole="button"
            onPress={category.onClear}
            className="min-h-11 justify-center rounded-md border border-border px-4 active:bg-accent dark:border-border-dark dark:active:bg-accent-dark"
          >
            <Text className="text-base font-semibold text-primary dark:text-primary-dark">
              Lihat semua produk
            </Text>
          </Pressable>
        </View>
      ) : status === "error" && !isFetching ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : fetchStatus === "paused" ? (
        // No network (onlineManager, src/lib/query-client.ts): the query
        // waits instead of failing, and runs when the network is back.
        <EmptyState message="Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali." />
      ) : (
        <LoadingState label="Memuat produk…" />
      )
    ) : (
      <EmptyState
        message={
          filters.q === undefined && filters.category === undefined
            ? "Belum ada produk."
            : "Tidak ada produk yang cocok."
        }
      />
    );

  return (
    <FlatList
      data={products}
      renderItem={renderProduct}
      keyExtractor={productKey}
      numColumns={COLUMNS}
      // grow: the content is at least as tall as the list, so the empty
      // state can centre itself in the free space.
      contentContainerClassName="grow px-2.5 pb-4"
      ListHeaderComponent={
        <View className="gap-2 px-1.5 pb-1.5 pt-4">
          {/* The active category as a chip; a press clears it, like the
              "x" on a filter chip. */}
          {category !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Kategori ${category.name}, hapus filter`}
              hitSlop={6}
              onPress={category.onClear}
              className="flex-row items-center gap-2 self-start rounded-full bg-muted px-3 py-1 active:bg-accent dark:bg-muted-dark dark:active:bg-accent-dark"
            >
              <Text className="text-sm font-semibold text-foreground dark:text-foreground-dark">
                {category.name}
              </Text>
              <Text className="text-base text-muted-foreground dark:text-muted-foreground-dark">
                ×
              </Text>
            </Pressable>
          )}
          <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {caption}
          </Text>
          {/* The products already on screen stay; this says they may be
              out of date, after a pull or a background refetch failed. */}
          {isRefetchError && products.length > 0 && (
            <ErrorState
              error={error}
              onRetry={() => {
                void refresh();
              }}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center">{empty}</View>
      }
      ListFooterComponent={
        <ProductListFooter
          count={products.length}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          error={error}
          fetchNextPage={() => {
            void fetchNextPage();
          }}
        />
      }
      // Ask for the next page when the end is one screen's height away,
      // so it usually arrives before the buyer gets there.
      onEndReached={loadMore}
      onEndReachedThreshold={1}
      refreshControl={
        // The platform's pull-to-refresh: Android's circle drops from the
        // top, iOS's spinner opens above the list. A native component with
        // colour props rather than a style, so the colours come from the
        // navigation theme, the same roles as the classes.
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => {
            void refresh();
          }}
          colors={[colors.primary]}
          progressBackgroundColor={colors.card}
          tintColor={colors.primary}
        />
      }
      // Dragging the list puts the keyboard away. iOS can follow the
      // finger ("interactive"); Android only knows "on-drag".
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      // A tap on a card works at the first touch; a tap on empty space
      // closes the keyboard.
      keyboardShouldPersistTaps="handled"
    />
  );
}
