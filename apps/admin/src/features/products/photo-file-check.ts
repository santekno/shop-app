import {
  PRODUCT_IMAGE_SNIFF_BYTES,
  productImageDimensionsProblem,
  productImageSizeProblem,
  productImageTypeProblem,
  sniffProductImageType,
} from "@goshop/shared";
import type { ProductImageContentType } from "@goshop/shared";

/** A file that may be uploaded, as what, or why not. */
export type PhotoFileCheck =
  | { ok: true; contentType: ProductImageContentType }
  | { ok: false; message: string };

/**
 * Checks a chosen file the way the API will, before a single byte is
 * uploaded, cheapest test first:
 *
 * 1. its size (5 MB): known without reading the file;
 * 2. its first bytes: really JPEG, PNG or WebP (sniffProductImageType),
 *    which is also the type the upload declares, whatever the extension
 *    says;
 * 3. its pixels: the browser decodes the preview (`previewUrl`, the
 *    file's object URL) and reports the photo's size, at most 6000 pixels
 *    a side and 24 megapixels. A file the browser cannot decode is broken.
 *
 * The API checks all of this again at confirm and has the last word; the
 * point here is to say "too big" in a second instead of after an upload.
 */
export const checkPhotoFile = async (
  file: File,
  previewUrl: string,
): Promise<PhotoFileCheck> => {
  const sizeProblem = productImageSizeProblem(file.size);
  if (sizeProblem !== undefined) return { ok: false, message: sizeProblem };

  const head = new Uint8Array(
    await file.slice(0, PRODUCT_IMAGE_SNIFF_BYTES).arrayBuffer(),
  );
  const contentType = sniffProductImageType(head);
  if (contentType === undefined) {
    return { ok: false, message: productImageTypeProblem(file.type) };
  }

  const image = new Image();
  image.src = previewUrl;
  try {
    await image.decode();
  } catch {
    return {
      ok: false,
      message: "Foto tidak dapat dibaca. Mungkin berkasnya rusak.",
    };
  }
  const pixelProblem = productImageDimensionsProblem(
    image.naturalWidth,
    image.naturalHeight,
  );
  if (pixelProblem !== undefined) return { ok: false, message: pixelProblem };

  return { ok: true, contentType };
};
