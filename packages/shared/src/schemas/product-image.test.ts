import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGES_MAX,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_PIXELS,
  PRODUCT_IMAGE_MAX_SIDE,
  PRODUCT_IMAGE_SNIFF_BYTES,
  PRODUCT_IMAGE_TYPES,
  productImageDimensionsProblem,
  productImageSizeProblem,
  productImageTypeProblem,
  sniffProductImageType,
} from "./product-image.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
/** The bytes of a plain-ASCII signature such as "RIFF". */
const ascii = (text: string) =>
  Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const webp = (fourCC: string) =>
  bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii(fourCC), 0x20, 0);

describe("the photo limits", () => {
  it("are the contract's", () => {
    expect(PRODUCT_IMAGE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(PRODUCT_IMAGE_MAX_BYTES).toBe(5_242_880);
    expect(PRODUCT_IMAGES_MAX).toBe(10);
    expect(PRODUCT_IMAGE_MAX_SIDE).toBe(6000);
    expect(PRODUCT_IMAGE_MAX_PIXELS).toBe(24_000_000);
    expect(PRODUCT_IMAGE_SNIFF_BYTES).toBe(14);
  });
});

describe("sniffProductImageType", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP (lossy)", webp("WEBPVP8 "), "image/webp"],
    ["WebP (lossless)", webp("WEBPVP8L"), "image/webp"],
  ])("knows %s by its first bytes", (_name, head, type) => {
    expect(sniffProductImageType(head)).toBe(type);
  });

  it.each([
    ["a GIF", bytes(...ascii("GIF89a"), 0, 0)],
    ["a RIFF that is not WebP (WAV)", webp("WAVEfmt ")],
    ["a RIFF with WEBP but no VP chunk", webp("WEBPXXXX")],
    ["too few bytes for JPEG", bytes(0xff, 0xd8)],
    ["too few bytes for PNG", PNG.slice(0, 7)],
    ["a cut-off WebP header", webp("WEBPVP8 ").slice(0, 12)],
    ["nothing", bytes()],
    ["a PNG signature one byte late", bytes(0, ...PNG)],
  ])("refuses %s", (_name, head) => {
    expect(sniffProductImageType(head)).toBeUndefined();
  });
});

describe("productImageSizeProblem", () => {
  it.each([1, 100_000, PRODUCT_IMAGE_MAX_BYTES])("accepts %d bytes", (size) => {
    expect(productImageSizeProblem(size)).toBeUndefined();
  });

  it("refuses an empty file", () => {
    expect(productImageSizeProblem(0)).toBe("Berkas ini kosong.");
  });

  it("refuses one byte over 5 MiB", () => {
    expect(productImageSizeProblem(PRODUCT_IMAGE_MAX_BYTES + 1)).toBe(
      "Foto lebih besar dari 5 MB. Perkecil atau kompres fotonya, lalu pilih lagi.",
    );
  });
});

describe("productImageTypeProblem", () => {
  it.each(["image/heic", "image/heif"])(
    "explains %s from an iPhone",
    (type) => {
      expect(productImageTypeProblem(type)).toBe(
        "Foto HEIC (dari iPhone) belum didukung. Simpan sebagai JPEG, lalu pilih lagi.",
      );
    },
  );

  it("explains a GIF", () => {
    expect(productImageTypeProblem("image/gif")).toBe(
      "GIF tidak didukung. Pilih foto JPEG, PNG, atau WebP.",
    );
  });

  it.each(["application/pdf", "image/jpeg", ""])(
    "says %j is not a photo",
    (type) => {
      expect(productImageTypeProblem(type)).toBe(
        "Berkas ini bukan foto JPEG, PNG, atau WebP.",
      );
    },
  );
});

describe("productImageDimensionsProblem", () => {
  it.each([
    [1, 1],
    [6000, 4000],
    [4000, 6000],
    [4898, 4898],
  ])("accepts %d × %d", (width, height) => {
    expect(productImageDimensionsProblem(width, height)).toBeUndefined();
  });

  it.each([
    [0, 100],
    [100, 0],
    [-1, 100],
  ])("calls %d × %d unreadable", (width, height) => {
    expect(productImageDimensionsProblem(width, height)).toBe(
      "Foto tidak dapat dibaca. Mungkin berkasnya rusak.",
    );
  });

  it.each([
    [6001, 1],
    [1, 6001],
    [5000, 5000],
  ])("refuses %d × %d, naming its size", (width, height) => {
    expect(productImageDimensionsProblem(width, height)).toBe(
      `Foto ${String(width)} × ${String(height)} piksel terlalu besar: paling banyak 6000 piksel per sisi dan 24 megapiksel. Perkecil, lalu pilih lagi.`,
    );
  });
});
