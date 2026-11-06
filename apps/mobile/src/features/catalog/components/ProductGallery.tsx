import { useEffect, useState } from "react";
import { FlatList, Text, useWindowDimensions, View } from "react-native";
import type {
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import type { ProductImage } from "@goshop/shared";

import { PageDots } from "@/components/PageDots";
import { Photo } from "@/components/Photo";
import { photoSources, prefetchPhotos, urlForWidth } from "./photo-sources";

interface ProductGalleryProps {
  images: readonly ProductImage[];
  /** The product's name: the alt text of a photo that has none. */
  productName: string;
}

/**
 * The product's photos as full-width square pages the finger snaps
 * between, with dots under them. No pinch to zoom (not in this chapter).
 *
 * Edge cases: no photos is the "Belum ada foto" placeholder; one photo is
 * a plain picture with no dots. The other photos are prefetched into the
 * image cache as soon as the gallery appears. Each photo is announced as "<alt>, foto 2
 * dari 4" (the API's alt text may be empty, then the product's name); a
 * screen reader user swipes through the photos like any list.
 *
 * Mount it with `key={product.id}`: the current page is state, and a
 * different product must start at the first photo.
 */
export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  // The first photo is on screen already (the card showed it); fetch the
  // others now, while the buyer reads the name and price, so a swipe finds
  // them in the cache instead of a grey square. At the width the gallery
  // draws them, from the same variant the view will pick.
  useEffect(() => {
    prefetchPhotos(images.slice(1).map((image) => urlForWidth(image, width)));
  }, [images, width]);

  if (images.length === 0) {
    return (
      <View
        style={{ width, height: width }}
        className="items-center justify-center bg-muted dark:bg-muted-dark"
      >
        <Text className="font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
          Belum ada foto
        </Text>
      </View>
    );
  }

  const renderPhoto: ListRenderItem<ProductImage> = ({ item, index }) => (
    <Photo
      source={photoSources(item)}
      recyclingKey={item.id}
      fit="cover"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${item.alt === "" ? productName : item.alt}, foto ${index + 1} dari ${images.length}`}
      style={{ width, height: width }}
      className="bg-muted dark:bg-muted-dark"
    />
  );

  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View>
      <FlatList
        horizontal
        pagingEnabled
        data={images}
        keyExtractor={(image) => image.id}
        renderItem={renderPhoto}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSettle}
      />
      <PageDots count={images.length} index={page} />
    </View>
  );
}
