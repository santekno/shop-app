import { memo, useMemo } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { ListRenderItem } from "react-native";
import { router } from "expo-router";
import { formatRupiah } from "@goshop/shared";
import type { ProductImage } from "@goshop/shared";

import { SectionHeader } from "@/components/SectionHeader";
import { announce } from "@/lib/announce";
import { ProductPhoto } from "@/features/catalog/components/ProductPhoto";
import { useRecentlyViewed } from "../hooks/useRecentlyViewed";
import type { RecentItem } from "../recent-state";

const openRecent = (slug: string) => {
  router.push({ pathname: "/produk/[slug]", params: { slug } });
};

interface RecentCardProps {
  item: RecentItem;
}

/** One small card. Memo: the row re-renders only for a changed list. */
const RecentCard = memo(function RecentCard({ item }: RecentCardProps) {
  const { slug, name, image, priceFrom, hasPriceRange } = item;
  const price = formatRupiah({ amount: priceFrom, currency: "IDR" });
  // ProductPhoto draws a ProductImage; the stored one is the narrowest
  // variant alone, so `variants` is empty and the photo is its own source.
  const photo = useMemo<ProductImage | undefined>(
    () => (image === null ? undefined : { ...image, alt: "", variants: [] }),
    [image],
  );
  return (
    <View className="w-36 p-1.5">
      <Pressable
        onPress={() => {
          openRecent(slug);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${hasPriceRange ? "mulai " : ""}${price}`}
        accessibilityHint="Membuka halaman produk"
        className="gap-1 rounded-lg border border-border bg-card p-2 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark"
      >
        <ProductPhoto image={photo} />
        <Text
          numberOfLines={2}
          className="mt-1 font-sans text-sm font-semibold text-foreground dark:text-foreground-dark"
        >
          {name}
        </Text>
        <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
          {price}
        </Text>
      </Pressable>
    </View>
  );
});

const renderRecent: ListRenderItem<RecentItem> = ({ item }) => (
  <RecentCard item={item} />
);
const recentKey = (item: RecentItem) => item.slug;

interface RecentlyViewedProps {
  /** The list around the row pads this much each side; the row bleeds out. */
  bleed: number;
}

/**
 * "Terakhir dilihat": a horizontal row of the products the buyer opened,
 * newest first, with "Hapus" to empty it. Nothing at all (no header, no
 * gap) before the stored list has been read, and when it is empty: a
 * first-time buyer does not see an empty section, and a returning buyer
 * does not see it flash and fill in.
 */
export function RecentlyViewed({ bleed }: RecentlyViewedProps) {
  const { items, hydrated, clear } = useRecentlyViewed();
  if (!hydrated || items.length === 0) return null;

  return (
    <View testID="recently-viewed">
      <View className="flex-row items-end justify-between">
        <SectionHeader title="Terakhir dilihat" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hapus riwayat terakhir dilihat"
          hitSlop={6}
          onPress={() => {
            clear();
            announce("Riwayat terakhir dilihat dihapus");
          }}
          className="min-h-12 justify-center px-3"
        >
          <Text className="font-sans text-sm font-semibold text-primary dark:text-primary-dark">
            Hapus
          </Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={recentKey}
        renderItem={renderRecent}
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -bleed }}
        contentContainerStyle={{ paddingHorizontal: bleed }}
      />
    </View>
  );
}
