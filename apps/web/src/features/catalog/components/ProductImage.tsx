interface ProductImageProps {
  /** The product's name, for the photo's alt text. */
  name: string;
  /**
   * The photo's URL. The API already sends `product.images` (Bab 6), but
   * this chapter passes no `src` on purpose, so every product shows the
   * placeholder. Bab 11 wires the photos: `srcset` from each image's
   * `variants`, and the storage origin in the CSP's `img-src`.
   */
  src?: string | undefined;
}

/**
 * A product's photo, or a placeholder while it has none.
 *
 * More JSX rules at work here:
 * - `{…}` holds any JavaScript expression: a variable, a call, a ternary.
 *   Statements (`if`, `for`) do not fit inside; compute before `return`.
 * - Attributes are camelCase (`viewBox` and `strokeWidth` in SVG,
 *   `strokeLinejoin`), except `aria-*` and `data-*`, which keep their dashes.
 * - Returning early is ordinary JavaScript: the photo when there is one,
 *   otherwise the placeholder.
 */
export function ProductImage({ name, src }: ProductImageProps) {
  if (src !== undefined && src !== "") {
    return (
      <img
        className="product-image block aspect-square w-full rounded-md bg-muted object-cover"
        src={src}
        alt={name}
        loading="lazy"
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
