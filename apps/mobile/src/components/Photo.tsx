// The app's one remote image: expo-image with the settings every photo
// shares. React Native's Image leaves caching to the platform and draws
// nothing, then snaps the photo in, while it loads. expo-image (SDWebImage
// on iOS, Glide on Android) keeps a memory and a disk cache of its own,
// keyed by URL, fades the photo in, and is built for recycled list cells
// (`recyclingKey`).
import { Image } from "expo-image";
import type { ImageProps } from "expo-image";
import { cssInterop } from "nativewind";

// expo-image is not one of React Native's components, so NativeWind does
// not know its className: this maps it to `style`, as Icon does for Svg.
const StyledImage = cssInterop(Image, { className: "style" });

/** How long the photo takes to fade in, in ms. */
export const PHOTO_FADE_MS = 150;

type PhotoProps = Pick<
  ImageProps,
  | "source"
  | "recyclingKey"
  | "accessibilityLabel"
  | "accessible"
  | "accessibilityRole"
  | "style"
> & {
  className?: string;
  /** "cover" (default) crops to fill the box; "contain" shows all of it. */
  fit?: "cover" | "contain";
};

/**
 * A remote photo. The cache policy, the fade and the fit are decided here,
 * so every photo of the app behaves the same.
 *
 * The placeholder is the colour behind the photo: the caller's `bg-muted`
 * class. The API sends no blurhash, so there is no blurred preview to
 * show; a flat neutral box that the photo fades in over is the honest
 * version, and it is the same grey as the "Belum ada foto" box.
 *
 * `recyclingKey` matters in a FlashList: a cell is reused for another
 * product, and without a key the previous product's photo stays visible
 * until the new one has loaded. With the key, expo-image clears it first.
 */
export function Photo({ fit = "cover", className, ...props }: PhotoProps) {
  return (
    <StyledImage
      {...props}
      className={className}
      contentFit={fit}
      // Memory first, then disk: the second sight of a list or a product
      // draws from memory, the next launch of the app from disk, and only
      // the first sight of a URL is a download. It is also the default,
      // written out because it is the point of this component.
      cachePolicy="memory-disk"
      transition={PHOTO_FADE_MS}
    />
  );
}
