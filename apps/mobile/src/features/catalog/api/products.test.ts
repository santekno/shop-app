import { describe, expect, it } from "@jest/globals";

import { deferred, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { CATALOG_PAGE_SIZE, fetchProductPage } from "./products";

const sentQuery = () =>
  Object.fromEntries(
    fakeApi.requests("GET", "/v1/products")[0]?.url.searchParams ?? [],
  );

describe("fetchProductPage", () => {
  it("asks for 20 products by default and returns the page as it came", async () => {
    const page = productPage([product("Kaos")], "c2");
    fakeApi.on("GET", "/v1/products", () => json(page));

    await expect(fetchProductPage({ sort: "newest" }, null)).resolves.toEqual(
      page,
    );
    expect(CATALOG_PAGE_SIZE).toBe(20);
    expect(sentQuery()).toEqual({ limit: "20", sort: "newest" });
  });

  it("leaves the cursor out for the first page and sends it after", async () => {
    fakeApi.on("GET", "/v1/products", () => json(productPage([])));

    await fetchProductPage({ category: "kaos" }, null);
    await fetchProductPage({ category: "kaos" }, "c1");

    const [first, second] = fakeApi.requests("GET", "/v1/products");
    expect(first?.url.searchParams.has("cursor")).toBe(false);
    expect(second?.url.searchParams.get("cursor")).toBe("c1");
    expect(second?.url.searchParams.get("category")).toBe("kaos");
  });

  it("lets the caller choose the page size", async () => {
    fakeApi.on("GET", "/v1/products", () => json(productPage([])));
    await fetchProductPage({ limit: 5, q: "topi" }, null);
    expect(sentQuery()).toEqual({ limit: "5", q: "topi" });
  });

  it("passes the signal on: aborting it cancels the request", async () => {
    const answer = deferred();
    fakeApi.on("GET", "/v1/products", answer.handler);
    const controller = new AbortController();

    const pending = fetchProductPage({}, null, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(fakeApi.requests()[0]?.init.signal?.aborted).toBe(true);
  });
});
