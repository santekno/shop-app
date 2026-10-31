import { Image, Text, View } from "react-native";
import type { ImageURISource } from "react-native";
import type { ProductImage } from "@goshop/shared";

interface ProductPhotoProps {
  /** The product's first photo, or undefined while it has none. */
  image: ProductImage | undefined;
}

/**
 * The API's variants (400 and 800 pixels wide) as an `Image` source.
 *
 * A source can be a list of sizes, React Native's `srcset`: once the
 * image's box is laid out, the native side picks the smallest one that
 * still fills it at the screen's pixel density. A 180-dp card on a 2.6×
 * phone needs about 470 pixels, so it takes the 800; the same card on a
 * 1.5× phone takes the 400. Only `url` (the widest) is used when a photo
 * somehow has no variants.
 */
const sourcesOf = (image: ProductImage): ImageURISource[] =>
  (image.variants.length > 0 ? image.variants : [image]).map((variant) => ({
    uri: variant.url,
    width: variant.width,
    height: variant.height,
  }));

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
 * Unlike an `<img>`, a remote `Image` has no size of its own: React Native
 * does not download the file to measure it, so a photo without a width and
 * a height in its style is drawn 0 × 0 (an invisible card). Here the width
 * is the card's (w-full) and the height follows from aspect-square, with
 * the muted colour underneath while the file downloads. An Image clips its
 * own corners (rounded-md); no overflow-hidden needed.
 *
 * No `alt` here: the card around it is one accessible element whose label
 * already names the product, so the photo would only be read twice.
 */
export function ProductPhoto({ image }: ProductPhotoProps) {
  if (image !== undefined) {
    return (
      <Image
        source={sourcesOf(image)}
        // cover: fill the square and crop the overflow, like object-cover.
        resizeMode="cover"
        className={PHOTO}
      />
    );
  }

  return (
    <View className={`${PHOTO} items-center justify-center`}>
      <Text className="text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Belum ada foto
      </Text>
    </View>
  );
}
