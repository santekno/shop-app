import { Text, View } from "react-native";
import type { ProductImage } from "@goshop/shared";

import { Photo } from "@/components/Photo";
import { photoSources } from "./photo-sources";

interface ProductPhotoProps {
  /** The product's first photo, or undefined while it has none. */
  image: ProductImage | undefined;
}

/**
 * The square both the photo and the placeholder draw: the full width of
 * the card and as tall as it is wide (the web's `aspect-square`). Written
 * out in full in one constant, so Tailwind finds every class when it scans
 * this file; a class assembled from pieces at run time would never be
 * generated.
 */
const PHOTO = "aspect-square w-full rounded-md bg-muted dark:bg-muted-dark";

/**
 * A product's photo, or a placeholder while it has none.
 *
 * Unlike an `<img>`, a remote image has no size of its own: the app does
 * not download the file to measure it, so a photo without a width and a
 * height in its style is drawn 0 × 0 (an invisible card). Here the width
 * is the card's (w-full) and the height follows from aspect-square, with
 * the muted colour underneath while the file downloads (the placeholder,
 * see Photo). The image clips its own corners (rounded-md).
 *
 * No `alt` here: the card around it is one accessible element whose label
 * already names the product, so the photo would only be read twice.
 */
export function ProductPhoto({ image }: ProductPhotoProps) {
  if (image !== undefined) {
    return (
      <Photo
        source={photoSources(image)}
        // The cell is recycled for another product while scrolling; the key
        // tells expo-image to drop the old photo at once.
        recyclingKey={image.id}
        // cover: fill the square and crop the overflow, like object-cover.
        fit="cover"
        className={PHOTO}
      />
    );
  }

  return (
    <View className={`${PHOTO} items-center justify-center`}>
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Belum ada foto
      </Text>
    </View>
  );
}
