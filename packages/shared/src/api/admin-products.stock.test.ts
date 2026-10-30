import { describe, expect, it, vi } from "vitest";
import { adjustVariantStock } from "./admin-products.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { AdminVariant } from "./types.ts";

const setup = (response: () => Response, { retries = 0 } = {}) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries,
    retryDelayMs: 0,
  });
  const call = () => {
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    return { url: new URL(typeof input === "string" ? input : ""), init };
  };
  return { api, fetchMock, call };
};

const variant = {
  id: "v-1",
  stock: 17,
  version: 4,
} as unknown as AdminVariant;

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "boom", details } }, { status });

describe("adjustVariantStock", () => {
  it("POSTs a delta to the variant's stock adjustments and unwraps the variant", async () => {
    const { api, call } = setup(() => Response.json({ data: variant }));

    await expect(
      adjustVariantStock(api, "p-1", "v-1", { delta: 5 }),
    ).resolves.toEqual(variant);

    expect(call().url.pathname).toBe(
      "/v1/admin/products/p-1/variants/v-1/stock-adjustments",
    );
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual({ delta: 5 });
  });

  it("sends a count with the stock it expects", async () => {
    const { api, call } = setup(() => Response.json({ data: variant }));

    await adjustVariantStock(api, "p-1", "v-1", { set: 20, expected: 12 });

    expect(JSON.parse(call().init?.body as string)).toEqual({
      set: 20,
      expected: 12,
    });
  });

  it("escapes both IDs, so each stays one path segment", async () => {
    const { api, call } = setup(() => Response.json({ data: variant }));

    await adjustVariantStock(api, "p/1", "v?2", { delta: 1 });

    expect(call().url.pathname).toBe(
      "/v1/admin/products/p%2F1/variants/v%3F2/stock-adjustments",
    );
    expect(call().url.search).toBe("");
  });

  it("throws STOCK_CHANGED with the stock now", async () => {
    const { api } = setup(() => apiError(409, "STOCK_CHANGED", { stock: 9 }));

    const error: unknown = await adjustVariantStock(api, "p-1", "v-1", {
      set: 20,
      expected: 12,
    }).catch((e: unknown) => e);

    expect(isApiError(error, "STOCK_CHANGED")).toBe(true);
    expect(error).toMatchObject({ status: 409, details: { stock: 9 } });
  });

  it("never retries: a delta sent twice would count twice", async () => {
    const { api, fetchMock } = setup(() => apiError(503, "UNAVAILABLE"), {
      retries: 3,
    });

    await expect(
      adjustVariantStock(api, "p-1", "v-1", { delta: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: variant }));
    const controller = new AbortController();

    const pending = adjustVariantStock(
      api,
      "p-1",
      "v-1",
      { delta: 1 },
      { signal: controller.signal },
    );
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
