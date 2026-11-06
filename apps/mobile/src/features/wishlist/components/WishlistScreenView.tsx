import { useInfiniteQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import type { ListRenderItem } from "@shopify/flash-list";
import { View } from "react-native";
import type { Product } from "@goshop/shared";

import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StatusMessage";
import { ProductCard } from "@/features/catalog/components/ProductCard";
import { openProduct } from "@/features/catalog/open-product";
import { SIGN_IN_MESSAGE } from "../messages";
import { isSignedIn, wishlistListQuery } from "../hooks/useWishlist";

// Outside the component, like ProductList's: a stable renderItem keeps
// memo(ProductCard) effective.
const renderSaved: ListRenderItem<Product> = ({ item }) => (
  <View className="grow p-1.5">
    <ProductCard product={item} onPress={openProduct} />
  </View>
);
const productKey = (product: Product) => product.id;

/**
 * "Wishlist saya": the saved products, newest saved first, in the same
 * cards as the catalog. States: signed out (the API is not called), loading,
 * offline, failed with a retry, empty, and the list with the next page
 * loaded near the end. Removing a heart here keeps the card until the list
 * is refetched (onSettled), so an accidental tap can be undone.
 */
export function WishlistScreenView() {
  const signedIn = isSignedIn();
  const query = useInfiniteQuery(wishlistListQuery(signedIn));

  if (!signedIn) {
    return (
      <View className="flex-1 items-center justify-center">
        <EmptyState message={`${SIGN_IN_MESSAGE}.`} />
      </View>
    );
  }
  const products = query.data?.pages.flatMap((page) => page.data) ?? [];
  if (query.data === undefined) {
    return (
      <View className="flex-1 items-center justify-center">
        {query.fetchStatus === "paused" ? (
          <EmptyState message="Tidak ada koneksi internet. Wishlist dimuat begitu koneksi kembali." />
        ) : query.status === "error" ? (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : (
          <LoadingState label="Memuat wishlist…" />
        )}
      </View>
    );
  }
  return (
    <FlashList
      data={products}
      renderItem={renderSaved}
      keyExtractor={productKey}
      numColumns={2}
      maintainVisibleContentPosition={{ disabled: true }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}
      ListEmptyComponent={
        <EmptyState message="Belum ada produk di wishlist. Ketuk ikon hati pada produk untuk menyimpannya." />
      }
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      }}
      onEndReachedThreshold={1}
    />
  );
}
