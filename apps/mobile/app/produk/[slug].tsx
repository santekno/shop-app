// The product detail, at /produk/<slug> (goshop://produk/<slug>). The
// brackets make the segment a parameter, like app/produk/[slug]/page.tsx in
// apps/web. It fetches GET /v1/products/{slug} and shows the photos, the
// variants with their price and stock (src/features/catalog).
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isApiError } from "@goshop/shared";

import { EmptyState, ErrorState } from "@/components/StatusMessage";
import { productDetailQuery } from "@/features/catalog/api/queries";
import { ProductDetailSkeleton } from "@/features/catalog/components/ProductSkeletons";
import { ProductDetailView } from "@/features/catalog/components/ProductDetailView";
import { useRecordRecentlyViewed } from "@/features/recent/hooks/useRecentlyViewed";
import { queryView } from "@/lib/query-state";

export default function ProductScreen() {
  // Typed by the route: slug is a string. Like a URL path segment on the
  // web, it is input from outside (anyone can open goshop://produk/…), so
  // the API, not this screen, decides whether it names a product.
  const { slug } = useLocalSearchParams<"/produk/[slug]">();
  const query = useQuery(productDetailQuery(slug));
  const view = queryView(query);
  // Only once the product has loaded: a slug that names nothing is not
  // "viewed" (Terakhir dilihat, artikel 15).
  useRecordRecentlyViewed(query.data);

  return (
    // Pushed above the tabs, so no tab bar protects the bottom edge. The
    // stack's header already sits below the status bar; only the bottom
    // inset is this screen's job. SafeAreaView comes from a library, so
    // NativeWind does not know its className; flex: 1 is the one style it
    // needs.
    <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
      {/* The header says "Produk" until the product is known, then its name. */}
      <Stack.Screen options={{ title: query.data?.name ?? "Produk" }} />
      {query.data !== undefined ? (
        <ProductDetailView product={query.data} />
      ) : view === "loading" ? (
        // The page's own outline while it loads (artikel 08).
        <ProductDetailSkeleton />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          {view === "offline" && (
            <EmptyState message="Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali." />
          )}
          {view === "error" &&
            (isApiError(query.error, "NOT_FOUND") ? (
              // A product that does not exist, or no longer: retrying
              // would fail the same way, so no "Coba lagi".
              <EmptyState message="Produk tidak ditemukan." />
            ) : (
              <ErrorState
                error={query.error}
                onRetry={() => {
                  void query.refetch();
                }}
              />
            ))}
        </View>
      )}
    </SafeAreaView>
  );
}
