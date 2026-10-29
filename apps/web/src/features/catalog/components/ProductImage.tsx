import type { ProductImage as Photo } from "@goshop/shared";

/**
 * How the photo is loaded (Bab 11 artikel 12):
 *
 * - "lazy": the browser fetches it only when it nears the screen. Cards
 *   below the first row: a phone that never scrolls never pays for them.
 * - "eager": fetched with the page, at normal priority. The first row of
 *   cards, which is on screen at once (lazy-loading those would only
 *   delay them).
 * - "priority": eager and `fetchpriority="high"`: the product page's main
 *   photo, its Largest Contentful Paint. The browser requests it before
 *   the scripts and styles it would otherwise queue first.
 */
export type ImageLoading = "lazy" | "eager" | "priority";

interface ProductImageProps {
  /** The product's first ready photo, or undefined when it has none. */
  image: Photo | undefined;
  /** The product's name: the alt text when the photo has none. */
  productName: string;
  /**
   * How wide the image is drawn, per layout, as the `sizes` attribute:
   * with it the browser picks the smallest variant that is sharp enough
   * before any CSS has loaded.
   */
  sizes: string;
  loading?: ImageLoading;
}

/** The variants as a `srcset`, narrowest first: "…/400.jpg 400w, …/800.jpg 800w". */
const srcSetOf = (image: Photo): string =>
  [...image.variants]
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${String(variant.width)}w`)
    .join(", ");

/**
 * A product's photo, or a placeholder while it has none (Bab 11 artikel
 * 12; Bab 8 drew only the placeholder).
 *
 * A plain <img> with a `srcset` built from the API's `variants`, not
 * next/image. The worker already resizes every photo to 400 and 800
 * pixels wide JPEGs (ADR 0007), served from the image storage with a
 * year-long immutable cache. next/image's optimiser would fetch them
 * again through this server, resize them a second time with sharp, and
 * keep a second cache, so each container spends CPU and disk on work
 * already done; a custom next/image loader could only map a width to a
 * variant by guessing the storage's file names, where `variants` is the
 * contract. What next/image would add, WebP or AVIF, belongs to the
 * worker (ADR 0007 records why it writes JPEG).
 *
 * What the browser gets, the same as next/image would give it:
 * - `srcset` + `sizes`: a 412-pixel phone at 2× takes the 400 on a card,
 *   the 800 on the product page;
 * - `width` and `height` from the API: the box is reserved before the
 *   file arrives, so nothing below it jumps (Cumulative Layout Shift);
 *   the square frame (`aspect-square`, `object-cover`) is drawn by CSS;
 * - `alt`: the photo's own, or the product's name (the contract's rule
 *   for an empty alt);
 * - `decoding="async"`: decoding the JPEG does not hold up the page.
 *
 * The image's origin must be in the CSP's img-src (src/proxy.ts,
 * IMAGE_ORIGIN).
 */
export function ProductImage({
  image,
  productName,
  sizes,
  loading = "lazy",
}: ProductImageProps) {
  if (image !== undefined) {
    return (
      // A plain <img> on purpose (above); the rule suggests next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="product-image block aspect-square w-full rounded-md bg-muted object-cover"
        src={image.url}
        srcSet={srcSetOf(image)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={image.alt === "" ? productName : image.alt}
        loading={loading === "lazy" ? "lazy" : "eager"}
        fetchPriority={loading === "priority" ? "high" : "auto"}
        decoding="async"
      />
    );
  }

  // The placeholder says nothing a screen reader needs: the product's name
  // is in the heading next to it. aria-hidden keeps it out of the reading.
  // product-image and product-image--placeholder style nothing: hooks
  // for the tests. The square, the corners and the muted surface are
  // utilities.
  return (
    <div
      className="product-image product-image--placeholder flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md bg-muted text-sm text-muted-foreground"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none">
        <path
          d="M5 8h14l-1.2 12H6.2z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M9 8a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>Belum ada foto</span>
    </div>
  );
}
