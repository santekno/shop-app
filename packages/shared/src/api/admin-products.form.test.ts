import { describe, expect, it, vi } from "vitest";
import {
  archiveProduct,
  createProduct,
  getAdminProduct,
  updateProduct,
} from "./admin-products.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { AdminProduct, ProductWrite } from "./types.ts";

// The four calls of the product form (artikel 03). The table, photos and
// stock calls have test files of their own.

const setup = (response: () => Response, { retries = 0 } = {}) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries,
    retryDelayMs: 0,
  });
  const call = (index = 0) => {
    const [input, init] = fetchMock.mock.calls[index] ?? [];
    return { url: new URL(typeof input === "string" ? input : ""), init };
  };
  return { api, fetchMock, call };
};

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "boom", details } }, { status });

const ID = "11111111-1111-4111-8111-111111111111";
const product = {
  id: ID,
  name: "Kaos Polos",
  version: 3,
} as unknown as AdminProduct;
const body: ProductWrite = {
  version: 3,
  category_id: "22222222-2222-4222-8222-222222222222",
  slug: "kaos-polos",
  name: "Kaos Polos",
  description: "",
  status: "active",
  variants: [
    { sku: "KPH-M", name: "M", price: 89_000, stock: 12, weight_grams: 250 },
  ],
};

describe("getAdminProduct", () => {
  it("GETs one product and unwraps it", async () => {
    const { api, call } = setup(() => Response.json({ data: product }));

    await expect(getAdminProduct(api, ID)).resolves.toEqual(product);

    expect(call().url.pathname).toBe(`/v1/admin/products/${ID}`);
    expect(call().init?.method ?? "GET").toBe("GET");
  });

  it("escapes the ID", async () => {
    const { api, call } = setup(() => Response.json({ data: product }));

    await getAdminProduct(api, "../a?b");

    expect(call().url.pathname).toBe("/v1/admin/products/..%2Fa%3Fb");
  });

  it("passes the caller's signal on, and throws NOT_FOUND", async () => {
    const found = setup(() => Response.json({ data: product }));
    const controller = new AbortController();
    const pending = getAdminProduct(found.api, ID, {
      signal: controller.signal,
    });
    controller.abort();
    expect(found.fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);

    const { api } = setup(() => apiError(404, "NOT_FOUND"));
    const error: unknown = await getAdminProduct(api, ID).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });
});

describe("createProduct", () => {
  it("POSTs the product and returns it as stored", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: product }, { status: 201 }),
    );

    await expect(createProduct(api, body)).resolves.toEqual(product);

    expect(call().url.pathname).toBe("/v1/admin/products");
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual(body);
  });

  it("is never retried, and throws the API's code", async () => {
    const { api, fetchMock } = setup(() => apiError(503, "UNAVAILABLE"), {
      retries: 3,
    });

    await expect(createProduct(api, body)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const taken = setup(() => apiError(409, "SLUG_TAKEN"));
    const error: unknown = await createProduct(taken.api, body).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "SLUG_TAKEN")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: product }));
    const controller = new AbortController();

    const pending = createProduct(api, body, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("updateProduct", () => {
  it("PUTs the whole product, version included, to its escaped path", async () => {
    const { api, call } = setup(() => Response.json({ data: product }));

    await expect(updateProduct(api, ID, body)).resolves.toEqual(product);
    await updateProduct(api, "a/b", body);

    expect(call(0).url.pathname).toBe(`/v1/admin/products/${ID}`);
    expect(call(0).init?.method).toBe("PUT");
    expect(JSON.parse(call(0).init?.body as string)).toMatchObject({
      version: 3,
    });
    expect(call(1).url.pathname).toBe("/v1/admin/products/a%2Fb");
  });

  it("is never retried, and throws VERSION_CONFLICT with its details", async () => {
    const { api, fetchMock } = setup(() =>
      apiError(409, "VERSION_CONFLICT", { product_id: ID }),
    );

    const error: unknown = await updateProduct(api, ID, body, {
      signal: new AbortController().signal,
    }).catch((e: unknown) => e);

    expect(isApiError(error, "VERSION_CONFLICT")).toBe(true);
    expect(error).toMatchObject({ details: { product_id: ID } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: product }));
    const controller = new AbortController();

    const pending = updateProduct(api, ID, body, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("archiveProduct", () => {
  it("DELETEs the product and resolves to nothing on 204", async () => {
    const { api, call } = setup(() => new Response(null, { status: 204 }));

    await expect(archiveProduct(api, ID)).resolves.toBeUndefined();

    expect(call().url.pathname).toBe(`/v1/admin/products/${ID}`);
    expect(call().init?.method).toBe("DELETE");
  });

  it("throws NOT_FOUND", async () => {
    const { api } = setup(() => apiError(404, "NOT_FOUND"));

    const error: unknown = await archiveProduct(api, ID).catch(
      (e: unknown) => e,
    );

    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => new Response(null, { status: 204 }));
    const controller = new AbortController();

    const pending = archiveProduct(api, ID, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
