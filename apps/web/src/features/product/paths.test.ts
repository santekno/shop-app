import { matchPath } from "react-router";
import { describe, expect, it } from "vitest";
import {
  FROM_CATALOG,
  PRODUCT_ROUTE,
  cameFromCatalog,
  productPath,
} from "./paths.ts";

describe("productPath", () => {
  it("builds /produk/:slug", () => {
    expect(productPath("kaos-polos")).toBe("/produk/kaos-polos");
  });

  it("encodes the slug as one path segment", () => {
    expect(productPath("a/b?c#d")).toBe("/produk/a%2Fb%3Fc%23d");
  });

  it("matches PRODUCT_ROUTE with the slug as its parameter", () => {
    expect(
      matchPath(PRODUCT_ROUTE, productPath("kaos-polos-hitam"))?.params.slug,
    ).toBe("kaos-polos-hitam");
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
