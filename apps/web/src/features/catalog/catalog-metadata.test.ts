import { describe, expect, it } from "vitest";
import { category } from "@/test/fake-api.ts";
import { readCatalogFilters } from "./catalog-filters.ts";
import { catalogPageMeta } from "./catalog-metadata.ts";

const CATEGORIES = [category("c1", "Kaos"), category("c2", "Kemeja")];

/** The metadata of the catalog at `search` ("?kategori=kaos"). */
const metaAt = (
  search: string,
  categories = CATEGORIES as typeof CATEGORIES | null,
) =>
  catalogPageMeta(readCatalogFilters(new URLSearchParams(search)), categories);

const ALL_DESCRIPTION =
  "Belanja pakaian, elektronik, perlengkapan rumah, dan camilan di GoShop.";

describe("catalogPageMeta", () => {
  it("indexes the catalog root, canonical to /", () => {
    expect(metaAt("")).toEqual({
      title: "Katalog",
      description: ALL_DESCRIPTION,
      canonicalPath: "/",
      index: true,
    });
  });

  it("indexes a category that exists, canonical to itself, named after it", () => {
    expect(metaAt("?kategori=kaos")).toEqual({
      title: "Kaos",
      description: "Belanja Kaos di GoShop: harga, varian, dan stok terbaru.",
      canonicalPath: "/?kategori=kaos",
      index: true,
    });
  });

  it.each([
    ["the root", "?urut=termurah", "/"],
    ["a category", "?kategori=kaos&urut=termahal", "/?kategori=kaos"],
    [
      "the default sort spelled out",
      "?kategori=kaos&urut=terbaru",
      "/?kategori=kaos",
    ],
  ])(
    "points a sorted %s at the unsorted URL, still indexed",
    (_, search, path) => {
      const meta = metaAt(search);

      expect(meta.canonicalPath).toBe(path);
      expect(meta.index).toBe(true);
    },
  );

  it("drops what the filters ignore (other parameters) from the canonical URL", () => {
    expect(metaAt("?kategori=kaos&utm_source=x&urut=bogus").canonicalPath).toBe(
      "/?kategori=kaos",
    );
  });

  it("keeps a search out of the index, with no canonical, whatever else it has", () => {
    expect(metaAt("?q=kaos+hitam&kategori=kaos&urut=termurah")).toEqual({
      title: "Hasil pencarian “kaos hitam”",
      description: "Produk GoShop untuk pencarian “kaos hitam”.",
      canonicalPath: undefined,
      index: false,
    });
  });

  it("keeps a category that does not exist out of the index", () => {
    expect(metaAt("?kategori=sepatu")).toEqual({
      title: "Kategori tidak ditemukan",
      description: ALL_DESCRIPTION,
      canonicalPath: undefined,
      index: false,
    });
  });

  it("treats the category as one that exists when the API did not answer", () => {
    expect(metaAt("?kategori=sepatu&urut=termurah", null)).toEqual({
      title: "Katalog",
      description:
        "Belanja Katalog di GoShop: harga, varian, dan stok terbaru.",
      canonicalPath: "/?kategori=sepatu",
      index: true,
    });
  });
});
