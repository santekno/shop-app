import { describe, expect, it } from "vitest";
import {
  SORT_OPTIONS,
  catalogSearch,
  catalogSearchParams,
  readCatalogFilters,
} from "./catalog-filters.ts";
import type { CatalogFilters } from "./catalog-filters.ts";

const read = (search: string) =>
  readCatalogFilters(new URLSearchParams(search));

const NONE: CatalogFilters = {
  category: undefined,
  q: undefined,
  sort: "newest",
};

describe("readCatalogFilters", () => {
  it("gives the whole catalog, newest first, for no parameters", () => {
    expect(read("")).toEqual(NONE);
  });

  it("reads kategori, q and urut", () => {
    expect(read("?kategori=kaos-polos&q=hitam&urut=termurah")).toEqual({
      category: "kaos-polos",
      q: "hitam",
      sort: "price_asc",
    });
  });

  it.each([
    ["upper case", "Kaos"],
    ["a space", "kaos polos"],
    ["an underscore", "kaos_polos"],
    ["a double hyphen", "kaos--polos"],
    ["a leading hyphen", "-kaos"],
    ["a trailing hyphen", "kaos-"],
    ["a path", "../admin"],
    ["an empty value", ""],
  ])("ignores a category slug with %s", (_, slug) => {
    expect(read(`?kategori=${encodeURIComponent(slug)}`).category).toBe(
      undefined,
    );
  });

  it("accepts a slug of 100 characters and ignores one of 101", () => {
    expect(read(`?kategori=${"a".repeat(100)}`).category).toBe("a".repeat(100));
    expect(read(`?kategori=${"a".repeat(101)}`).category).toBeUndefined();
  });

  it("trims the search text and drops an empty one", () => {
    expect(read("?q=%20%20kaos%20polos%20").q).toBe("kaos polos");
    expect(read("?q=%20%20%20").q).toBeUndefined();
    expect(read("?q=").q).toBeUndefined();
  });

  it("cuts the search text to 100 characters, counted as code points", () => {
    expect(read(`?q=${"a".repeat(150)}`).q).toBe("a".repeat(100));
    const emoji = "😀".repeat(150);
    const q = read(`?q=${encodeURIComponent(emoji)}`).q ?? "";
    expect(Array.from(q)).toHaveLength(100);
    expect(q).toBe("😀".repeat(100));
  });

  it.each([
    ["terbaru", "newest"],
    ["termurah", "price_asc"],
    ["termahal", "price_desc"],
  ])("reads urut=%s as %s", (param, sort) => {
    expect(read(`?urut=${param}`).sort).toBe(sort);
  });

  it.each(["murah", "price_asc", "TERMURAH", ""])(
    "falls back to newest for urut=%j",
    (param) => {
      expect(read(`?urut=${param}`).sort).toBe("newest");
    },
  );
});

describe("catalogSearchParams and catalogSearch", () => {
  it("leave every default out", () => {
    expect(catalogSearchParams(NONE).toString()).toBe("");
    expect(catalogSearch(NONE)).toBe("");
  });

  it("write the filters in a fixed order with the Indonesian names", () => {
    const filters: CatalogFilters = {
      sort: "price_desc",
      q: "kaos polos",
      category: "pakaian",
    };

    expect(catalogSearch(filters)).toBe(
      "?kategori=pakaian&q=kaos+polos&urut=termahal",
    );
  });

  it("write only what is set", () => {
    expect(catalogSearch({ ...NONE, q: "hitam" })).toBe("?q=hitam");
    expect(catalogSearch({ ...NONE, sort: "price_asc" })).toBe(
      "?urut=termurah",
    );
  });

  it.each(SORT_OPTIONS.map((option) => option.value))(
    "round-trip with readCatalogFilters for sort %s",
    (sort) => {
      const filters: CatalogFilters = { category: "kaos", q: "polos", sort };
      expect(readCatalogFilters(catalogSearchParams(filters))).toEqual(filters);
    },
  );
});
