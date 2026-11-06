// Which of the API's resized variants (400 and 800 pixels wide today) a
// photo should be drawn from, and warming the cache with them.
import { Image } from "expo-image";
import type { ImageSource } from "expo-image";
import { PixelRatio } from "react-native";
import type { ProductImage } from "@goshop/shared";

/**
 * The variants as expo-image sources. A list of sources is srcset: once
 * the image's box is laid out, the native side picks the smallest one that
 * still fills it at the screen's pixel density (a 180-dp card on a 2.6×
 * phone needs about 470 pixels, so it takes the 800; on a 1.5× phone the
 * 400). Only `url` (the widest) is used when a photo has no variants.
 */
export const photoSources = (image: ProductImage): ImageSource[] =>
  (image.variants.length > 0 ? image.variants : [image]).map((variant) => ({
    uri: variant.url,
    width: variant.width,
    height: variant.height,
  }));

/**
 * The one URL to prefetch for a box `dp` wide: the smallest variant that
 * covers it at this screen's density, or the widest when none does. It
 * must be the URL the view will ask for, or the prefetch downloads a file
 * that is never shown. The same rule as the srcset choice above.
 */
export const urlForWidth = (image: ProductImage, dp: number): string => {
  const needed = dp * PixelRatio.get();
  const variants = [...image.variants].sort((a, b) => a.width - b.width);
  return (
    variants.find((variant) => variant.width >= needed)?.url ??
    variants.at(-1)?.url ??
    image.url
  );
};

/** URLs asked for already, so scrolling back does not queue them again. */
const prefetched = new Set<string>();

/**
 * Downloads photos into expo-image's memory and disk cache ahead of the
 * buyer: the rows below the screen, the gallery's other pages. A failure
 * is not an error: the photo loads when the view asks for it.
 */
export const prefetchPhotos = (urls: readonly string[]): void => {
  const fresh = urls.filter((url) => !prefetched.has(url));
  if (fresh.length === 0) return;
  for (const url of fresh) prefetched.add(url);
  Image.prefetch(fresh, "memory-disk").catch(() => {
    // Not cached: forget them, so a later call may try again.
    for (const url of fresh) prefetched.delete(url);
  });
};
