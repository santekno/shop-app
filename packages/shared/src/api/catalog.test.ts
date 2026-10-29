import { describe, expect, it, vi } from "vitest";
import { getProduct, listCategories, listProducts } from "./catalog.ts";
import { createApiClient } from "./client.ts";
import { ApiError, isApiError } from "./errors.ts";
import type { Category, Product, ProductList } from "./types.ts";

const categories: Category[] = [
  { id: "1", slug: "pakaian", name: "Pakaian", parent_id: null },
  { id: "2", slug: "kaos", name: "Kaos", parent_id: "1" },
];

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  return { api, fetchMock };
};

describe("listCategories", () => {
  it("GETs /v1/categories and returns the list inside the envelope", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: categories }));

    await expect(listCategories(api)).resolves.toEqual(categories);

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://api.test/v1/categories");
    expect(init?.method).toBe("GET");
  });

  it("returns an empty list as it is", async () => {
    const { api } = setup(() => Response.json({ data: [] }));

    await expect(listCategories(api)).resolves.toEqual([]);
  });

  it("passes the caller's signal on, so aborting it cancels the request", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: [] }));
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const controller = new AbortController();

    const pending = listCategories(api, { signal: controller.signal });
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("lets an API error through", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "INTERNAL_ERROR", message: "boom" } },
        { status: 500 },
      ),
    );

    const error: unknown = await listCategories(api).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

const product: Product = {
  id: "p1",
  slug: "kaos-polos",
  name: "Kaos Polos",
  description: "Katun.",
  category: { id: "2", slug: "kaos", name: "Kaos", parent_id: "1" },
  price_from: { amount: 89_000, currency: "IDR" },
  in_stock: true,
  variants: [
    {
      id: "v1",
      sku: "KP-M",
      name: "M",
      price: { amount: 89_000, currency: "IDR" },
      stock: 3,
    },
  ],
  images: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

/** A fetch that answers nothing and rejects once its signal aborts, like the real one. */
const untilAborted = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const urlOf = (fetchMock: ReturnType<typeof setup>["fetchMock"]) => {
  const input = fetchMock.mock.calls[0]?.[0];
  if (typeof input !== "string") throw new Error("fetch got no URL string");
  return input;
};

describe("listProducts", () => {
  const page: ProductList = { data: [product], page: { next_cursor: "c2" } };

  it("GETs /v1/products without a query string when given no filters", async () => {
    const { api, fetchMock } = setup(() => Response.json(page));

    await listProducts(api);

    expect(urlOf(fetchMock)).toBe("http://api.test/v1/products");
  });

  it("returns the whole body, products and page", async () => {
    const { api } = setup(() => Response.json(page));

    await expect(listProducts(api, { limit: 12 })).resolves.toEqual(page);
  });

  it("sends only the parameters that are defined, cursor included", async () => {
    const { api, fetchMock } = setup(() => Response.json(page));

    await listProducts(api, {
      category: "kaos",
      q: undefined,
      sort: "price_asc",
      cursor: "eyJpZCI6MX0=",
      limit: 12,
    });

    expect(urlOf(fetchMock)).toBe(
      "http://api.test/v1/products?category=kaos&sort=price_asc&cursor=eyJpZCI6MX0%3D&limit=12",
    );
  });

  it("leaves an undefined cursor out", async () => {
    const { api, fetchMock } = setup(() => Response.json(page));

    await listProducts(api, { q: "kaos polos", cursor: undefined });

    expect(urlOf(fetchMock)).toBe("http://api.test/v1/products?q=kaos+polos");
  });

  it("passes the caller's signal on, so aborting it cancels the request", async () => {
    const { api, fetchMock } = setup(() => Response.json(page));
    fetchMock.mockImplementationOnce(untilAborted);
    const controller = new AbortController();

    const pending = listProducts(api, {}, { signal: controller.signal });
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});

describe("getProduct", () => {
  it("GETs /v1/products/{slug} and returns the product inside the envelope", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: product }));

    await expect(getProduct(api, "kaos-polos")).resolves.toEqual(product);
    expect(urlOf(fetchMock)).toBe("http://api.test/v1/products/kaos-polos");
  });

  it.each([
    ["a/b?c", "a%2Fb%3Fc"],
    ["kaos polos#1", "kaos%20polos%231"],
    ["../admin", "..%2Fadmin"],
  ])("encodes the slug %j as one path segment", async (slug, encoded) => {
    const { api, fetchMock } = setup(() => Response.json({ data: product }));

    await getProduct(api, slug);

    expect(urlOf(fetchMock)).toBe(`http://api.test/v1/products/${encoded}`);
  });

  it("throws NOT_FOUND for a slug that names no product", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "NOT_FOUND", message: "product not found" } },
        { status: 404 },
      ),
    );

    const error: unknown = await getProduct(api, "nope").catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
    expect(error).toMatchObject({ status: 404 });
  });

  it("passes the caller's signal on, so aborting it cancels the request", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: product }));
    fetchMock.mockImplementationOnce(untilAborted);
    const controller = new AbortController();

    const pending = getProduct(api, "kaos-polos", {
      signal: controller.signal,
    });
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});
