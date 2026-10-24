import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  fetchMock,
  product,
  productResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { createTestQueryClient } from "@/test/render.tsx";
import { productQuery } from "@/features/product/api/queries.ts";
import { catalogKeys, categoriesQuery } from "./queries.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const lastRequest = () => {
  const call = fetchMock.mock.lastCall;
  if (!call) throw new Error("no request was sent");
  return { url: requestUrl(call[0]), init: call[1] };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("catalogKeys", () => {
  it("nests every product key under ['products']", () => {
    const filters = { category: "kaos", limit: 12 };

    expect(catalogKeys.categories).toEqual(["categories"]);
    expect(catalogKeys.products).toEqual(["products"]);
    expect(catalogKeys.productLists()).toEqual(["products", "list"]);
    expect(catalogKeys.productList(filters)).toEqual([
      "products",
      "list",
      filters,
    ]);
    expect(catalogKeys.productDetail("kaos")).toEqual([
      "products",
      "detail",
      "kaos",
    ]);
  });

  it("lets invalidating ['products'] reach every list and every product", async () => {
    const client = createTestQueryClient();
    client.setQueryData(catalogKeys.productList({ limit: 12 }), "list");
    client.setQueryData(catalogKeys.productDetail("kaos"), "detail");
    client.setQueryData(catalogKeys.categories, "categories");

    await client.invalidateQueries({ queryKey: catalogKeys.products });

    const stale = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated;
    expect(stale(catalogKeys.productList({ limit: 12 }))).toBe(true);
    expect(stale(catalogKeys.productDetail("kaos"))).toBe(true);
    expect(stale(catalogKeys.categories)).toBe(false);
  });
});

describe("categoriesQuery", () => {
  it("fetches GET /v1/categories under ['categories'], fresh for 5 minutes", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([category("1", "Kaos")]));
    const options = categoriesQuery();

    expect(options.queryKey).toEqual(["categories"]);
    expect(options.staleTime).toBe(5 * 60_000);
    await expect(createTestQueryClient().query(options)).resolves.toEqual([
      category("1", "Kaos"),
    ]);
    expect(lastRequest().url.pathname).toBe("/v1/categories");
  });

  it("passes TanStack Query's abort signal to the request", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const client = createTestQueryClient();

    void client.query(categoriesQuery()).catch(() => undefined);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const signal = lastRequest().init?.signal;
    expect(signal?.aborted).toBe(false);
    await client.cancelQueries({ queryKey: catalogKeys.categories });

    expect(signal?.aborted).toBe(true);
  });
});

describe("productQuery", () => {
  it("fetches GET /v1/products/{slug} under ['products', 'detail', slug]", async () => {
    const kaos = product("kaos");
    fetchMock.mockResolvedValue(productResponse(kaos));
    const options = productQuery("kaos");

    expect(options.queryKey).toEqual(["products", "detail", "kaos"]);
    await expect(createTestQueryClient().query(options)).resolves.toEqual(kaos);
    expect(lastRequest().url.pathname).toBe("/v1/products/kaos");
  });
});
