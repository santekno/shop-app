import { describe, expect, it } from "vitest";
import {
  jpegFile,
  notAPhoto,
  pngNamedJpeg,
  sizedFile,
  stubImageDecode,
} from "@/test/products-photos.ts";
import { checkPhotoFile } from "./photo-file-check.ts";

describe("checkPhotoFile", () => {
  it("accepts a JPEG whose pixels fit, as image/jpeg, decoding the preview", async () => {
    const { sources } = stubImageDecode({ width: 6000, height: 4000 });

    await expect(checkPhotoFile(jpegFile(), "blob:preview-1")).resolves.toEqual(
      {
        ok: true,
        contentType: "image/jpeg",
      },
    );
    expect(sources).toEqual(["blob:preview-1"]);
  });

  it("declares the type its bytes say, not its name", async () => {
    stubImageDecode();

    await expect(checkPhotoFile(pngNamedJpeg(), "blob:x")).resolves.toEqual({
      ok: true,
      contentType: "image/png",
    });
  });

  it("refuses an empty file before reading it", async () => {
    const { sources } = stubImageDecode();

    await expect(checkPhotoFile(sizedFile(0), "blob:x")).resolves.toEqual({
      ok: false,
      message: "Berkas ini kosong.",
    });
    expect(sources).toEqual([]);
  });

  it("refuses a file over 5 MB first, without decoding it", async () => {
    const { sources } = stubImageDecode();

    const result = await checkPhotoFile(
      sizedFile(5 * 1024 * 1024 + 1),
      "blob:x",
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Foto lebih besar dari 5 MB. Perkecil atau kompres fotonya, lalu pilih lagi.",
    });
    expect(sources).toEqual([]);
  });

  it("explains a HEIC from the type the browser guessed, without decoding it", async () => {
    const { sources } = stubImageDecode();

    await expect(checkPhotoFile(notAPhoto(), "blob:x")).resolves.toEqual({
      ok: false,
      message:
        "Foto HEIC (dari iPhone) belum didukung. Simpan sebagai JPEG, lalu pilih lagi.",
    });
    expect(sources).toEqual([]);
  });

  it("calls an unknown file not a photo", async () => {
    stubImageDecode();

    await expect(
      checkPhotoFile(notAPhoto("daftar.pdf", "application/pdf"), "blob:x"),
    ).resolves.toEqual({
      ok: false,
      message: "Berkas ini bukan foto JPEG, PNG, atau WebP.",
    });
  });

  it("calls a file the browser cannot decode broken", async () => {
    stubImageDecode({ fails: true });

    await expect(checkPhotoFile(jpegFile(), "blob:x")).resolves.toEqual({
      ok: false,
      message: "Foto tidak dapat dibaca. Mungkin berkasnya rusak.",
    });
  });

  it("refuses a photo of more than 24 megapixels", async () => {
    stubImageDecode({ width: 5000, height: 5000 });

    await expect(checkPhotoFile(jpegFile(), "blob:x")).resolves.toEqual({
      ok: false,
      message:
        "Foto 5000 × 5000 piksel terlalu besar: paling banyak 6000 piksel per sisi dan 24 megapiksel. Perkecil, lalu pilih lagi.",
    });
  });
});
