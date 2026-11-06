import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

import { PageDots } from "@/components/PageDots";
import { SectionStatus } from "@/components/SectionStatus";
import { queryView } from "@/lib/query-state";
import { bannerBackground, bannerForeground } from "../banner-colors";
import type { Banner } from "../api/banners";
import { bannersQuery } from "../api/queries";

/** The card's height; the loading box has the same, so nothing jumps. */
const BANNER_HEIGHT = 144;

interface BannerCarouselProps {
  /** Called with the category slug of the banner the buyer tapped. */
  onOpenCategory: (slug: string) => void;
  /**
   * How far the list around the carousel pads each side, in dp. The
   * carousel cancels it so its pages are as wide as the screen and a swipe
   * starts at the screen's edge, not 10 dp inside it.
   */
  bleed: number;
}

/**
 * The home screen's banner carousel: GET /v1/banners as full-width pages
 * the finger snaps between, dots under them. A tap on a banner that links
 * to a category opens the catalog narrowed to it.
 *
 * States: loading (a box the card's size), offline, failed with a retry,
 * and no banners at all, which draws nothing: a shop without a campaign
 * has no carousel, and an empty box titled "Banner" would only be noise.
 */
export function BannerCarousel({ onOpenCategory, bleed }: BannerCarouselProps) {
  const query = useQuery(bannersQuery());
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const view = queryView(query);

  if (view !== "ready") {
    return (
      <View
        style={{ minHeight: BANNER_HEIGHT }}
        className="justify-center rounded-lg bg-muted dark:bg-muted-dark"
      >
        <SectionStatus
          view={view}
          what="banner"
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }

  const banners = query.data ?? [];
  if (banners.length === 0) return null;

  const renderBanner: ListRenderItem<Banner> = ({ item, index }) => (
    <View style={{ width }} className="px-4">
      <BannerCard
        banner={item}
        position={index + 1}
        total={banners.length}
        onOpenCategory={onOpenCategory}
      />
    </View>
  );

  // The page the scroll came to rest on: the offset divided by a page.
  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={{ marginHorizontal: -bleed }}>
      <FlatList
        horizontal
        pagingEnabled
        data={banners}
        keyExtractor={(banner) => banner.id}
        renderItem={renderBanner}
        // Fixed-size pages: FlatList can jump to any of them without
        // measuring the ones before it.
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSettle}
      />
      <PageDots count={banners.length} index={page} />
    </View>
  );
}

interface BannerCardProps {
  banner: Banner;
  position: number;
  total: number;
  onOpenCategory: (slug: string) => void;
}

/**
 * One coloured card. The colours come from the API at run time, so they
 * are `style`, not classes (a class built from data is never generated).
 * The whole card is one accessible element: title, subtitle and button
 * label read as one sentence with the position among the banners.
 */
function BannerCard({
  banner,
  position,
  total,
  onOpenCategory,
}: BannerCardProps) {
  const background = bannerBackground(banner.background_color);
  const foreground = bannerForeground(banner.background_color);
  const slug = banner.link_category_slug;
  const label = [
    `Banner ${position} dari ${total}`,
    banner.title,
    banner.subtitle,
    slug === null ? null : (banner.cta_label ?? "Lihat produk"),
  ]
    .filter((part) => part !== null && part !== "")
    .join(". ");

  const content = (
    <>
      <View className="gap-1">
        <Text
          numberOfLines={2}
          style={{ color: foreground }}
          className="font-sans text-xl font-bold"
        >
          {banner.title}
        </Text>
        {banner.subtitle !== null && (
          <Text
            numberOfLines={2}
            style={{ color: foreground }}
            className="font-sans text-sm"
          >
            {banner.subtitle}
          </Text>
        )}
      </View>
      {slug !== null && banner.cta_label !== null && (
        <View
          style={{ backgroundColor: foreground }}
          className="self-start rounded-full px-4 py-1.5"
        >
          <Text
            style={{ color: background }}
            className="font-sans text-sm font-semibold"
          >
            {banner.cta_label}
          </Text>
        </View>
      )}
    </>
  );

  const style = { backgroundColor: background, height: BANNER_HEIGHT };
  const className = "justify-between rounded-lg p-4";

  // A banner that links nowhere is a picture with words: not a button.
  if (slug === null) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={style}
        className={className}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      accessibilityHint="Membuka kategori produk"
      onPress={() => {
        onOpenCategory(slug);
      }}
      style={style}
      className={`${className} active:opacity-80`}
    >
      {content}
    </Pressable>
  );
}
