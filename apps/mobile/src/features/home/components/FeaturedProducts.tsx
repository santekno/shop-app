import { useQuery } from "@tanstack/react-query";
import { FlatList, View } from "react-native";
import type { ListRenderItem } from "react-native";
import type { Product } from "@goshop/shared";

import { SectionHeader } from "@/components/SectionHeader";
import { SectionStatus } from "@/components/SectionStatus";
import { EmptyState } from "@/components/StatusMessage";
import { openProduct } from "@/features/catalog/open-product";
import { ProductCard } from "@/features/catalog/components/ProductCard";
import { FeaturedSkeleton } from "@/features/catalog/components/ProductSkeletons";
import { queryView } from "@/lib/query-state";
import { featuredProductsQuery } from "../api/queries";

// A function outside the component, like ProductList's: the list re-renders
// a cell when renderItem changes, and memo(ProductCard) skips a card only
// when its props keep their identity.
const renderFeatured: ListRenderItem<Product> = ({ item }) => (
  // 176 dp: a card and a bit of the next one, so the row reads as
  // scrollable on a 360 dp phone.
  <View className="w-44 p-1.5">
    <ProductCard product={item} onPress={openProduct} />
  </View>
);

const productKey = (product: Product) => product.id;

interface FeaturedProductsProps {
  /** The list around the row pads this much each side; the row bleeds out. */
  bleed: number;
}

/**
 * "Produk unggulan": GET /v1/products?featured=true as a horizontal row of
 * the catalog's own cards. States: loading, offline, failed with a retry,
 * and "Belum ada produk unggulan." when the shop has featured none.
 */
export function FeaturedProducts({ bleed }: FeaturedProductsProps) {
  const query = useQuery(featuredProductsQuery());
  const view = queryView(query);

  return (
    <View>
      <SectionHeader title="Produk unggulan" />
      {view === "loading" ? (
        <FeaturedSkeleton />
      ) : view !== "ready" ? (
        <SectionStatus
          view={view}
          what="produk unggulan"
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.data?.length === 0 ? (
        <EmptyState message="Belum ada produk unggulan." />
      ) : (
        <FlatList
          horizontal
          data={query.data}
          keyExtractor={productKey}
          renderItem={renderFeatured}
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -bleed }}
          contentContainerStyle={{ paddingHorizontal: bleed }}
        />
      )}
    </View>
  );
}
