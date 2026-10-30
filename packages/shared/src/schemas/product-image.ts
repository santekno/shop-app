import type { ProductImageContentType } from "../api/types.ts";

// The rules for a product photo, mirroring what the API checks (api/
// openapi.yaml: ImageUploadRequest and confirmProductImage; apps/api/
// internal/product/image.go). A client checks them before it uploads, so a
// seller hears "too big" at once instead of after a 5 MB upload; the API
// checks every one of them again and has the last word.

/** The file types a photo may be: the contract's `content_type` enum. */
export const PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const satisfies readonly ProductImageContentType[];

/** The largest file the API signs an upload for: 5 MiB. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Photos per product, pending uploads included. */
export const PRODUCT_IMAGES_MAX = 10;

/** The longest side of a photo, in pixels. */
export const PRODUCT_IMAGE_MAX_SIDE = 6000;

/** Width × height, at most: 24 megapixels. */
export const PRODUCT_IMAGE_MAX_PIXELS = 24_000_000;

/** How many leading bytes sniffProductImageType looks at. */
export const PRODUCT_IMAGE_SNIFF_BYTES = 14;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, index) => bytes[at + index] === byte);

const JPEG = [0xff, 0xd8, 0xff] as const;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBPVP = [0x57, 0x45, 0x42, 0x50, 0x56, 0x50] as const; // "WEBPVP"

/**
 * The photo type a file really is, from its first bytes, or `undefined`
 * for anything else (a GIF, a HEIC, a PDF renamed to .jpg). The same
 * signatures as Go's `http.DetectContentType`, which the API runs on the
 * uploaded file at confirm: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A
 * 0A`, WebP `RIFF`, four bytes of size, `WEBPVP`.
 *
 * Why not the browser's `file.type`: it comes from the file's extension.
 * A PNG saved as `foto.jpg` would be declared `image/jpeg`, signed so, and
 * refused at confirm after the whole upload. Declaring the sniffed type
 * uploads it correctly instead.
 */
export const sniffProductImageType = (
  head: Uint8Array,
): ProductImageContentType | undefined => {
  if (startsWith(head, JPEG)) return "image/jpeg";
  if (startsWith(head, PNG)) return "image/png";
  if (startsWith(head, RIFF) && startsWith(head, WEBPVP, 8)) {
    return "image/webp";
  }
  return undefined;
};

/** Why a file of `size` bytes cannot be a photo, or `undefined` when it can. */
export const productImageSizeProblem = (size: number): string | undefined => {
  if (size <= 0) return "Berkas ini kosong.";
  if (size > PRODUCT_IMAGE_MAX_BYTES) {
    return "Foto lebih besar dari 5 MB. Perkecil atau kompres fotonya, lalu pilih lagi.";
  }
  return undefined;
};

/**
 * Why a file whose first bytes are not a photo was refused. `declaredType`
 * is what the browser guessed from the extension (`file.type`), used only
 * to say something more helpful for the usual suspects.
 */
export const productImageTypeProblem = (declaredType: string): string => {
  if (declaredType === "image/heic" || declaredType === "image/heif") {
    return "Foto HEIC (dari iPhone) belum didukung. Simpan sebagai JPEG, lalu pilih lagi.";
  }
  if (declaredType === "image/gif") {
    return "GIF tidak didukung. Pilih foto JPEG, PNG, atau WebP.";
  }
  return "Berkas ini bukan foto JPEG, PNG, atau WebP.";
};

/** Why a photo of this many pixels is refused, or `undefined` when it is fine. */
export const productImageDimensionsProblem = (
  width: number,
  height: number,
): string | undefined => {
  if (width <= 0 || height <= 0) {
    return "Foto tidak dapat dibaca. Mungkin berkasnya rusak.";
  }
  if (
    width > PRODUCT_IMAGE_MAX_SIDE ||
    height > PRODUCT_IMAGE_MAX_SIDE ||
    width * height > PRODUCT_IMAGE_MAX_PIXELS
  ) {
    return `Foto ${width} × ${height} piksel terlalu besar: paling banyak 6000 piksel per sisi dan 24 megapiksel. Perkecil, lalu pilih lagi.`;
  }
  return undefined;
};
