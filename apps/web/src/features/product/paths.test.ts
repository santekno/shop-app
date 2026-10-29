import { describe, expect, it } from "vitest";
import { routeFor } from "@/test/app-routes.ts";
import {
  FROM_CATALOG,
  cameFromCatalog,
  productPath,
  productSlugFromPath,
} from "./paths.ts";

describe("productPath", () => {
  it("builds /produk/[slug]", () => {
    expect(productPath("kaos-polos")).toBe("/produk/kaos-polos");
  });

  it("encodes the slug as one path segment", () => {
    expect(productPath("a/b?c#d")).toBe("/produk/a%2Fb%3Fc%23d");
  });

  it.each(["kaos-polos-hitam", "a/b?c#d"])(
    "opens app/produk/[slug] with %s as the slug",
    (slug) => {
      const match = routeFor(productPath(slug));

      expect(match?.route.pattern).toBe("/produk/[slug]");
      expect(match?.params.slug).toBe(slug);
    },
  );
});

describe("productSlugFromPath", () => {
  it("gives back the slug productPath encoded", () => {
    expect(productSlugFromPath(productPath("a/b?c#d"))).toBe("a/b?c#d");
  });

  it.each([
    ["another page", "/keranjang"],
    ["the bare prefix", "/produk/"],
    ["a deeper path", "/produk/kaos/ulasan"],
    ["a broken escape", "/produk/%E0%A4%A"],
  ])("is undefined for %s", (_, path) => {
    expect(productSlugFromPath(path)).toBeUndefined();
  });
});

describe("cameFromCatalog", () => {
  it("recognises FROM_CATALOG", () => {
    expect(cameFromCatalog(FROM_CATALOG)).toBe(true);
    expect(cameFromCatalog({ fromCatalog: true, other: 1 })).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a string", "fromCatalog"],
    ["fromCatalog: 'true'", { fromCatalog: "true" }],
    ["fromCatalog: 1", { fromCatalog: 1 }],
    ["fromCatalog: false", { fromCatalog: false }],
  ])("refuses %s", (_, state) => {
    expect(cameFromCatalog(state)).toBe(false);
  });
});
