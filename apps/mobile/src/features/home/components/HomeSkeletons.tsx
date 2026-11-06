import { View } from "react-native";

import { Skeleton, SkeletonGroup } from "@/components/Skeleton";

/** The banner card's height (BannerCarousel's BANNER_HEIGHT). */
const BANNER_HEIGHT = 144;

/** A banner-sized block: the carousel's loading state. */
export function BannerSkeleton() {
  return (
    <SkeletonGroup label="Memuat banner…">
      <Skeleton
        style={{ height: BANNER_HEIGHT }}
        className="w-full rounded-lg"
      />
    </SkeletonGroup>
  );
}

/** A row of chips, as wide as real ones. */
export function CategoryChipsSkeleton() {
  return (
    <SkeletonGroup label="Memuat kategori…" className="flex-row gap-2">
      {[88, 72, 104, 80].map((width) => (
        <View key={width} style={{ width }}>
          <Skeleton className="h-12 w-full rounded-full" />
        </View>
      ))}
    </SkeletonGroup>
  );
}
