import { describe, expect, it } from "@jest/globals";

import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  it("has the shapes the cache is organised by", () => {
    expect(queryKeys.categories).toEqual(["categories"]);
    expect(queryKeys.banners).toEqual(["banners"]);
    expect(queryKeys.products.all).toEqual(["products"]);
    expect(queryKeys.products.lists()).toEqual(["products", "list"]);
    expect(queryKeys.products.list({ q: "kaos", sort: "newest" })).toEqual([
      "products",
      "list",
      { q: "kaos", sort: "newest" },
    ]);
    expect(queryKeys.products.featured()).toEqual(["products", "featured"]);
    expect(queryKeys.products.detail("kaos-polos")).toEqual([
      "products",
      "detail",
      "kaos-polos",
    ]);
    expect(queryKeys.wishlist.all).toEqual(["wishlist"]);
    expect(queryKeys.wishlist.ids()).toEqual(["wishlist", "ids"]);
    expect(queryKeys.wishlist.list()).toEqual(["wishlist", "list"]);
    expect(queryKeys.wishlist.toggle).toEqual(["wishlist", "toggle"]);
  });

  it("every product key starts with ['products'], so one prefix reaches them all", () => {
    for (const key of [
      queryKeys.products.lists(),
      queryKeys.products.list({}),
      queryKeys.products.featured(),
      queryKeys.products.detail("x"),
    ]) {
      expect(key[0]).toBe("products");
    }
  });

  it("two details of different slugs are different keys", () => {
    expect(queryKeys.products.detail("a")).not.toEqual(
      queryKeys.products.detail("b"),
    );
  });
});
