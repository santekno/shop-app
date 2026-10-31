import { describe, expect, it } from "@jest/globals";

import { createTestQueryClient } from "@/test/render";
import { deferred, fakeApi, json } from "@/test/fake-api";
import { category, product, productPage } from "@/test/fixtures";
import { catalogKeys, categoriesQuery, productListQuery } from "./queries";

describe("catalogKeys", () => {
  it("nests every product list under ['products']", () => {
    expect(catalogKeys.categories).toEqual(["categories"]);
    expect(catalogKeys.products).toEqual(["products"]);
    expect(catalogKeys.productLists()).toEqual(["products", "list"]);
    expect(catalogKeys.productList({ q: "kaos", sort: "newest" })).toEqual([
      "products",
      "list",
      { q: "kaos", sort: "newest" },
    ]);
  });
});

describe("productListQuery: getNextPageParam", () => {
  const next = (nextCursor: string | null, lastPageParam: string | null) => {
    const options = productListQuery({ sort: "newest" });
    return options.getNextPageParam(
      productPage([], nextCursor),
      [],
      lastPageParam,
      [],
    );
  };

  it("is the page's next_cursor", () => {
    expect(next("c1", null)).toBe("c1");
    expect(next("c2", "c1")).toBe("c2");
  });

  it("ends the list when next_cursor is null", () => {
    expect(next(null, "c1")).toBeUndefined();
    expect(next(null, null)).toBeUndefined();
  });

  it("ends the list when the API hands back the cursor just used", () => {
    // Asking with c1 again would fetch the same page forever.
    expect(next("c1", "c1")).toBeUndefined();
  });

  it("starts from no cursor", () => {
    expect(productListQuery({}).initialPageParam).toBeNull();
  });
});

describe("productListQuery: fetching", () => {
  it("keys the list by its filters and fetches the first page with them", async () => {
    const kaos = product("Kaos");
    fakeApi.on("GET", "/v1/products", () => json(productPage([kaos], "c1")));
    const filters = {
      category: "kaos",
      q: "polos",
      sort: "price_asc",
    } as const;
    const options = productListQuery(filters);
    expect(options.queryKey).toEqual(["products", "list", filters]);

    const data = await createTestQueryClient().infiniteQuery(options);

    expect(data.pages).toEqual([productPage([kaos], "c1")]);
    const [request] = fakeApi.requests();
    expect(request?.url.pathname).toBe("/v1/products");
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      limit: "20",
      category: "kaos",
      q: "polos",
      sort: "price_asc",
    });
  });

  it("aborts the request when the query is cancelled", async () => {
    const answer = deferred();
    fakeApi.on("GET", "/v1/products", answer.handler);
    const client = createTestQueryClient();
    const options = productListQuery({ sort: "newest" });

    const pending = client.infiniteQuery(options).catch(() => undefined);
    await Promise.resolve();
    await client.cancelQueries({ queryKey: options.queryKey });
    await pending;

    const [request] = fakeApi.requests();
    expect(request?.init.signal?.aborted).toBe(true);
  });
});

describe("categoriesQuery", () => {
  it("is GET /v1/categories under ['categories'], fresh for five minutes", async () => {
    const list = [category("pakaian", "Pakaian"), category("topi", "Topi")];
    fakeApi.on("GET", "/v1/categories", () => json({ data: list }));
    const options = categoriesQuery();

    expect(options.queryKey).toEqual(["categories"]);
    expect(options.staleTime).toBe(300_000);
    await expect(createTestQueryClient().query(options)).resolves.toEqual(list);
  });

  it("aborts the request when the query is cancelled", async () => {
    const answer = deferred();
    fakeApi.on("GET", "/v1/categories", answer.handler);
    const client = createTestQueryClient();

    const pending = client.query(categoriesQuery()).catch(() => undefined);
    await Promise.resolve();
    await client.cancelQueries({ queryKey: ["categories"] });
    await pending;

    expect(fakeApi.requests()[0]?.init.signal?.aborted).toBe(true);
  });
});
