import { describe, expect, it } from "@jest/globals";
import { Query } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import Constants from "expo-constants";

import { createTestQueryClient } from "@/test/render";
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  PERSIST_STORAGE_KEY,
  persistOptions,
  shouldPersistQuery,
} from "./query-persist";
import { queryKeys } from "./query-keys";

/** A query in the cache with this key, in this status. */
const queryOf = (
  key: QueryKey,
  status: "success" | "error" | "pending" = "success",
): Query => {
  const client = createTestQueryClient();
  const query = client.getQueryCache().build(client, { queryKey: key });
  if (status === "success") query.setData(["data"]);
  if (status === "error") {
    // Fails once, with nothing cached.
    query.setState({ status: "error", error: new Error("boom") } as never);
  }
  return query;
};

describe("shouldPersistQuery: what goes to the phone's disk", () => {
  it.each([
    ["categories", queryKeys.categories],
    ["banners", queryKeys.banners],
    ["a catalog list", queryKeys.products.list({ sort: "newest" })],
    [
      "a category list",
      queryKeys.products.list({ category: "kaos", sort: "newest" }),
    ],
    [
      "a list with an empty q",
      queryKeys.products.list({ q: "", sort: "newest" }),
    ],
    ["the featured row", queryKeys.products.featured()],
    ["a product page", queryKeys.products.detail("kaos-polos")],
  ])("saves %s", (_name, key) => {
    expect(shouldPersistQuery(queryOf(key))).toBe(true);
  });

  it.each([
    ["a search", queryKeys.products.list({ q: "kaos", sort: "newest" })],
    ["the wishlist ids", queryKeys.wishlist.ids()],
    ["the wishlist pages", queryKeys.wishlist.list()],
    ["the buyer's profile", ["me"]],
    ["the cart", ["cart"]],
    ["an unknown product kind", ["products", "other"]],
    ["a bare products key", ["products"]],
    ["an unknown scope", ["orders", 1]],
  ])("never saves %s", (_name, key) => {
    expect(shouldPersistQuery(queryOf(key))).toBe(false);
  });

  it("does not save a query that has not succeeded", () => {
    expect(shouldPersistQuery(queryOf(queryKeys.categories, "pending"))).toBe(
      false,
    );
    expect(shouldPersistQuery(queryOf(queryKeys.categories, "error"))).toBe(
      false,
    );
  });
});

describe("persistOptions", () => {
  it("saves under goshop.query-cache for at most a day", () => {
    expect(PERSIST_STORAGE_KEY).toBe("goshop.query-cache");
    expect(persistOptions.maxAge).toBe(PERSIST_MAX_AGE_MS);
    expect(PERSIST_MAX_AGE_MS).toBe(86_400_000);
  });

  it("drops the saved cache when the app version changes", () => {
    expect(PERSIST_BUSTER).toBe(Constants.expoConfig?.version ?? "0");
    expect(persistOptions.buster).toBe(PERSIST_BUSTER);
  });

  it("filters queries with shouldPersistQuery and never saves a mutation", () => {
    const dehydrate = persistOptions.dehydrateOptions;
    expect(dehydrate?.shouldDehydrateQuery).toBe(shouldPersistQuery);
    expect(dehydrate?.shouldDehydrateMutation?.({} as never)).toBe(false);
  });
});
