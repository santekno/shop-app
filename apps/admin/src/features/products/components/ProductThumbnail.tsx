import { ImageOff } from "lucide-react";

interface ProductThumbnailProps {
  /** The 400 px copy of the first ready photo, or null while there is none. */
  url: string | null;
}

/**
 * The small photo in the first column, 40 × 40.
 *
 * alt="" on purpose: the product's name is in the next cell of the same
 * row, so an alt text would make a screen reader say the name twice per
 * row. A photo that adds nothing the text does not say is decorative
 * (WCAG's H67), and an empty alt is how an image says so; a missing alt,
 * by contrast, makes some screen readers read the file name.
 *
 * width and height reserve the space before the photo arrives, so the
 * rows do not jump; loading="lazy" leaves photos below the fold for later.
 */
export function ProductThumbnail({ url }: ProductThumbnailProps) {
  if (url === null) {
    return (
      <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-4" />
        <span className="sr-only">Belum ada foto</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      className="size-10 rounded-md bg-muted object-cover"
    />
  );
}
