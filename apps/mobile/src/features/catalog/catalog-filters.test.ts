import { describe, expect, it } from "@jest/globals";

import { readCatalogFilters } from "./catalog-filters";

describe("readCatalogFilters: kategori", () => {
  it.each(["kaos", "kaos-polos", "kaos-polos-2", "a", "a".repeat(100)])(
    "sends %s as the category",
    (kategori) => {
      expect(readCatalogFilters({ kategori })).toEqual({
        category: kategori,
        sort: "newest",
      });
    },
  );

  it.each([
    ["uppercase", "Kaos"],
    ["an underscore", "kaos_polos"],
    ["a leading hyphen", "-kaos"],
    ["a trailing hyphen", "kaos-"],
    ["a double hyphen", "kaos--polos"],
    ["a space", "kaos polos"],
    ["a path", "../admin"],
    ["empty", ""],
    ["101 characters", "a".repeat(101)],
  ])(
    "drops a slug with %s: the whole catalog, not a 400",
    (_name, kategori) => {
      const filters = readCatalogFilters({ kategori });
      expect(filters).toEqual({ sort: "newest" });
      expect("category" in filters).toBe(false);
    },
  );

  it.each([
    ["two values", ["kaos", "topi"]],
    // One value in an array reads as "kaos" when coerced to a string, so
    // this is the case a typeof check is there for.
    ["one value", ["kaos"]],
  ])(
    "treats a repeated kategori (an array of %s) as absent",
    (_name, kategori) => {
      expect(readCatalogFilters({ kategori })).toEqual({ sort: "newest" });
    },
  );
});

describe("readCatalogFilters: q", () => {
  it("trims the search", () => {
    expect(readCatalogFilters({ q: "  polos \n" })).toEqual({
      q: "polos",
      sort: "newest",
    });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("leaves an %s search out", (_name, q) => {
    const filters = readCatalogFilters({ q });
    expect("q" in filters).toBe(false);
  });

  it("keeps exactly 100 characters and cuts the 101st", () => {
    const hundred = "a".repeat(100);
    expect(readCatalogFilters({ q: hundred }).q).toBe(hundred);
    expect(readCatalogFilters({ q: `${hundred}b` }).q).toBe(hundred);
  });

  it("cuts after trimming, so leading spaces do not use up the limit", () => {
    const hundred = "a".repeat(100);
    expect(readCatalogFilters({ q: `   ${hundred}` }).q).toBe(hundred);
  });

  it("counts code points, as the Go API counts runes: an emoji is one", () => {
    // Each 😀 is two UTF-16 units; counting units would keep 50 emoji.
    const q = readCatalogFilters({ q: "😀".repeat(101) }).q;
    expect(Array.from(q ?? "")).toHaveLength(100);
    expect(q).toBe("😀".repeat(100));
  });

  it.each([[["kaos", "topi"]], [["kaos"]]])(
    "treats a repeated q (%j) as absent",
    (q) => {
      expect(readCatalogFilters({ q })).toEqual({ sort: "newest" });
    },
  );
});

describe("readCatalogFilters: urut", () => {
  it.each([
    ["terbaru", "newest"],
    ["termurah", "price_asc"],
    ["termahal", "price_desc"],
  ])("turns urut=%s into sort=%s", (urut, sort) => {
    expect(readCatalogFilters({ urut })).toEqual({ sort });
  });

  it.each([
    ["an unknown word", "murah"],
    ["the API's own value", "price_asc"],
    ["a repeated value", ["termurah", "termahal"]],
    ["nothing", undefined],
  ])("falls back to newest for %s", (_name, urut) => {
    expect(readCatalogFilters({ urut }).sort).toBe("newest");
  });
});

describe("readCatalogFilters: all together", () => {
  it("reads the three parameters at once", () => {
    expect(
      readCatalogFilters({ kategori: "kaos", q: " polos ", urut: "termurah" }),
    ).toEqual({ category: "kaos", q: "polos", sort: "price_asc" });
  });

  it("keeps unset fields out of the object, for a stable query key", () => {
    expect(Object.keys(readCatalogFilters({}))).toEqual(["sort"]);
    expect(JSON.stringify(readCatalogFilters({ kategori: "", q: " " }))).toBe(
      JSON.stringify(readCatalogFilters({})),
    );
  });
});
