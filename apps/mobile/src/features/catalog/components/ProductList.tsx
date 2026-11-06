import { FlashList } from "@shopify/flash-list";
import type { ListRenderItem } from "@shopify/flash-list";
import { useTheme } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, RefreshControl, Text, View } from "react-native";
import { isApiError } from "@goshop/shared";
import type { Product } from "@goshop/shared";

import { Icon } from "@/components/Icon";
import {
  EmptyResult,
  EmptyState,
  ErrorState,
} from "@/components/StatusMessage";
import type { ProductListFilters } from "../api/products";
import { openProduct } from "../open-product";
import { useProductList } from "../hooks/useProductList";
import { ProductCard } from "./ProductCard";
import { ProductListFooter } from "./ProductListFooter";
import { ProductGridSkeleton } from "./ProductSkeletons";

/** Two cards per row: the app is phone-only (supportsTablet is false). */
const COLUMNS = 2;

// One cell, with 6 dp of padding all round. FlashList gives each cell its
// column's width itself (half the list with numColumns 2), so the cell has
// no width class; FlatList needed w-1/2 (artikel 06). Two cells side by
// side put 12 dp between their cards, and the list's own 10 dp of side
// padding makes 16 dp at the screen's edges. `grow` lets the cell, and the
// card in it, fill the row when the other card of the row is taller.
//
// A function outside the component, like openProduct: the list re-renders
// a cell when renderItem changes, and memo(ProductCard) skips a card only
// when its props are the same functions as before.
//
// No state inside a card: FlashList recycles cells, so a card scrolled
// off the top is re-rendered with another product instead of unmounted.
// State kept in it (useState) would travel to the next product.
const renderProduct: ListRenderItem<Product> = ({ item }) => (
  <View className="grow p-1.5">
    <ProductCard product={item} onPress={openProduct} />
  </View>
);

const productKey = (product: Product) => product.id;

/** The list's side padding in dp: 10 + a card's 6 = 16 at the screen's edge. */
export const CATALOG_SIDE_PADDING = 10;

/** grow px-2.5 pb-4, as numbers (see the list's contentContainerStyle). */
const CONTENT_STYLE = {
  flexGrow: 1,
  paddingHorizontal: CATALOG_SIDE_PADDING,
  paddingBottom: 16,
} as const;

interface ProductListProps {
  filters: ProductListFilters;
  /** One line above the first row: what is shown, in what order. */
  caption: string;
  /**
   * The category the list is narrowed to (filters.category), by its name
   * when known, and how to go back to every product.
   */
  category?: { name: string; onClear: () => void } | undefined;
  /**
   * Clears the search, the category and the order at once ("Reset
   * filter"). Given only when something is narrowing the list; the empty
   * state offers it as its way out.
   */
  onReset?: () => void;
  /**
   * What sits above the caption, scrolling with the list: Beranda's
   * banners, categories and featured products. One scroll view, not a
   * vertical list inside a vertical ScrollView.
   */
  header?: ReactNode;
  /**
   * Also refetched by a pull to refresh, with the list: the queries of
   * whatever `header` shows. The spinner stays until both have settled.
   */
  refreshAlso?: () => Promise<unknown>;
}

/**
 * The catalog: GET /v1/products for `filters`, two cards per row, the next
 * page loaded as the buyer nears the end, pulled down to refresh.
 *
 * A FlashList, not a ScrollView with every card in it, and since artikel
 * 07 not a FlatList either. A ScrollView mounts all its children at once
 * and keeps them. FlatList (artikel 06) mounts the rows near the screen
 * (`windowSize`: about ten screens' worth) and unmounts the rest. FlashList
 * keeps only a screen and a bit (`drawDistance`) of cells and recycles
 * them: a cell scrolled off one end is re-rendered with the product
 * coming in at the other. Measured on the emulator with the same cards
 * (README, artikel 07): about a tenth of FlatList's mounted cards, less
 * memory after a long scroll, the first rows sooner. Same props for the
 * rest: header, footer, empty state, onEndReached, the refresh control.
 */
export function ProductList({
  filters,
  caption,
  category,
  header,
  refreshAlso,
  onReset,
}: ProductListProps) {
  const { colors } = useTheme();
  const {
    data,
    products,
    status,
    fetchStatus,
    error,
    isFetching,
    isPlaceholderData,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetchError,
    hasNextPage,
    loadMore,
    retryNextPage,
    refetch,
    refresh,
    isRefreshing,
  } = useProductList(filters);

  // The list loaded and has no product. Three different reasons, three
  // different ways out: a search that matched nothing, a category with no
  // products yet, and a shop with none at all.
  const searched = filters.q !== undefined;
  const emptyResult = searched ? (
    <EmptyResult
      title={`Tidak ada hasil untuk "${filters.q}"`}
      hint="Periksa ejaan atau coba kata kunci lain, atau hapus filter."
      action={
        onReset === undefined
          ? undefined
          : { label: "Reset filter", onPress: onReset }
      }
    />
  ) : filters.category !== undefined ? (
    <EmptyResult
      title={`Belum ada produk di ${category?.name ?? "kategori ini"}`}
      hint="Produk baru akan muncul di sini. Lihat kategori lain sementara itu."
      action={
        onReset === undefined
          ? undefined
          : { label: "Lihat semua produk", onPress: onReset }
      }
    />
  ) : (
    <EmptyState message="Belum ada produk." />
  );

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
            className="min-h-12 justify-center rounded-md border border-border px-4 active:bg-accent dark:border-border-dark dark:active:bg-accent-dark"
          >
            <Text className="font-sans text-base font-semibold text-primary dark:text-primary-dark">
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
        // The grid's own shape, pulsing, instead of a spinner: the first
        // screen already looks like the catalog (artikel 08).
        <ProductGridSkeleton />
      )
    ) : (
      emptyResult
    );

  return (
    <FlashList
      // One list per search, sort and category, like the cache (one entry
      // per query key): a new filter starts at the top. Without the key the
      // list kept its scroll offset, and a cached result (no loading state
      // in between) opened scrolled to wherever the last one was.
      key={JSON.stringify(filters)}
      data={products}
      renderItem={renderProduct}
      keyExtractor={productKey}
      numColumns={COLUMNS}
      // flexGrow: the content is at least as tall as the list, so the
      // empty state can centre itself in the free space. A style, not
      // contentContainerClassName: NativeWind maps className props on
      // React Native's own components; FlashList is not one of them.
      contentContainerStyle={CONTENT_STYLE}
      // FlashList 2 keeps the first visible row in place when the data
      // changes, which suits a chat that grows at the top. The catalog only
      // grows at the end; with it on, a list that went from the loading
      // state to its rows opened scrolled to the end.
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={
        <>
          {header}
          <View className="gap-2 px-1.5 pb-1.5 pt-4">
            {/* The active category as a chip; a press clears it, like the
              "x" on a filter chip (Icon's tutup). */}
            {category !== undefined && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Kategori ${category.name}, hapus filter`}
                hitSlop={6}
                onPress={category.onClear}
                className="flex-row items-center gap-2 self-start rounded-full bg-muted px-3 py-1 active:bg-accent dark:bg-muted-dark dark:active:bg-accent-dark"
              >
                <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                  {category.name}
                </Text>
                <Icon
                  name="tutup"
                  className="text-muted-foreground dark:text-muted-foreground-dark"
                  size={16}
                />
              </Pressable>
            )}
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {caption}
              {/* The rows below are the previous search's until the new
                  ones arrive (placeholderData, queries.ts). */}
              {isPlaceholderData ? " · memperbarui…" : ""}
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
        </>
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
          fetchNextPage={retryNextPage}
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
            void refresh(refreshAlso);
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
