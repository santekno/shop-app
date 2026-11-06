// Skeletons of the catalog's own shapes, drawn at the same sizes as the
// real ones (ProductCard, ProductList) so nothing moves when data arrives.
import { View } from "react-native";

import { Skeleton, SkeletonGroup } from "@/components/Skeleton";

/** The outline of a ProductCard: photo, two lines of name, a price. */
export function ProductCardSkeleton() {
  return (
    <View className="grow gap-1 rounded-lg border border-border bg-card p-3 dark:border-border-dark dark:bg-card-dark">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-1 h-5 w-1/2" />
    </View>
  );
}

/**
 * The catalog before its first page: `count` cards in the list's two
 * columns, with the cell padding the list gives its real cards (p-1.5).
 * Even by default (six): three full rows fill a phone's first screen.
 */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonGroup label="Memuat produk…" className="w-full flex-row flex-wrap">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="w-1/2 p-1.5">
          <ProductCardSkeleton />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** The featured row: cards 176 dp wide like FeaturedProducts' cells. */
export function FeaturedSkeleton() {
  return (
    <SkeletonGroup label="Memuat produk unggulan…" className="flex-row">
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-44 p-1.5">
          <ProductCardSkeleton />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** The product page: gallery square, title, price, variants, description. */
export function ProductDetailSkeleton() {
  return (
    <SkeletonGroup label="Memuat produk…">
      <Skeleton className="aspect-square w-full rounded-none" />
      <View className="gap-4 px-4 pt-4">
        <View className="gap-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </View>
        <View className="gap-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
        </View>
        <View className="flex-row gap-2">
          <Skeleton className="h-12 w-20 rounded-full" />
          <Skeleton className="h-12 w-20 rounded-full" />
          <Skeleton className="h-12 w-20 rounded-full" />
        </View>
        <View className="gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </View>
      </View>
    </SkeletonGroup>
  );
}
