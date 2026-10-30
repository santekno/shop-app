import { describe, expect, it, vi } from "vitest";
import {
  cancelOrder,
  completeOrder,
  getAdminOrder,
  listAdminOrders,
  processOrder,
  shipOrder,
} from "./admin-orders.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { Order, OrderList } from "./types.ts";

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
    return {
      url: new URL(typeof input === "string" ? input : ""),
      init,
    };
  };
  return { api, fetchMock, call };
};

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "boom", details } }, { status });

const ID = "0b6d2a4e-0000-4000-8000-000000000001";
const order = {
  id: ID,
  code: "GS-20261030-7KQ2M9",
  status: "processing",
} as unknown as Order;
const page: OrderList = {
  data: [],
  page: { next_cursor: "c2" },
};

describe("listAdminOrders", () => {
  it("GETs the queue of a status with its cursor and limit", async () => {
    const { api, call } = setup(() => Response.json(page));

    await expect(
      listAdminOrders(api, { status: "processing", cursor: "c1", limit: 20 }),
    ).resolves.toEqual(page);

    expect(call().url.pathname).toBe("/v1/admin/orders");
    expect(Object.fromEntries(call().url.searchParams)).toEqual({
      status: "processing",
      cursor: "c1",
      limit: "20",
    });
    expect(call().init?.method ?? "GET").toBe("GET");
  });

  it("leaves out every missing parameter", async () => {
    const { api, call } = setup(() => Response.json(page));

    await listAdminOrders(api, { status: "paid", cursor: undefined });
    await listAdminOrders(api);

    expect(call(0).url.search).toBe("?status=paid");
    expect(call(1).url.search).toBe("");
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json(page));
    const controller = new AbortController();

    const pending = listAdminOrders(api, {}, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });

  it("throws the API's VALIDATION_FAILED for a cursor of another status", async () => {
    const { api } = setup(() =>
      apiError(400, "VALIDATION_FAILED", { cursor: "x" }),
    );

    const error: unknown = await listAdminOrders(api, { cursor: "c" }).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "VALIDATION_FAILED")).toBe(true);
  });
});

describe("getAdminOrder", () => {
  it("GETs one order and unwraps it", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await expect(getAdminOrder(api, ID)).resolves.toEqual(order);
    expect(call().url.pathname).toBe(`/v1/admin/orders/${ID}`);
  });

  it("escapes the ID, so a pasted URL stays one path segment", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await getAdminOrder(api, "../products/x?y=1");

    expect(call().url.pathname).toBe(
      "/v1/admin/orders/..%2Fproducts%2Fx%3Fy%3D1",
    );
    expect(call().url.search).toBe("");
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: order }));
    const controller = new AbortController();

    const pending = getAdminOrder(api, ID, { signal: controller.signal });
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });

  it("throws NOT_FOUND for an unknown order", async () => {
    const { api } = setup(() => apiError(404, "NOT_FOUND"));

    const error: unknown = await getAdminOrder(api, ID).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });
});

describe("the status changes", () => {
  it.each([
    [
      "processOrder",
      "process",
      (api: ReturnType<typeof createApiClient>) => processOrder(api, ID),
    ],
    [
      "completeOrder",
      "complete",
      (api: ReturnType<typeof createApiClient>) => completeOrder(api, ID),
    ],
    [
      "cancelOrder",
      "cancel",
      (api: ReturnType<typeof createApiClient>) => cancelOrder(api, ID),
    ],
  ])(
    "%s POSTs to /%s without a body and returns the order",
    async (_name, action, send) => {
      const { api, call } = setup(() => Response.json({ data: order }));

      await expect(send(api)).resolves.toEqual(order);

      expect(call().url.pathname).toBe(`/v1/admin/orders/${ID}/${action}`);
      expect(call().init?.method).toBe("POST");
      expect(call().init?.body).toBeUndefined();
    },
  );

  it("shipOrder POSTs the resi as JSON", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await expect(
      shipOrder(api, ID, { tracking_number: "JNE0123456789" }),
    ).resolves.toEqual(order);

    expect(call().url.pathname).toBe(`/v1/admin/orders/${ID}/ship`);
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual({
      tracking_number: "JNE0123456789",
    });
  });

  it("escapes the ID before the action", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await cancelOrder(api, "a/b");

    expect(call().url.pathname).toBe("/v1/admin/orders/a%2Fb/cancel");
  });

  it("throws INVALID_TRANSITION with the order's status now", async () => {
    const { api } = setup(() =>
      apiError(409, "INVALID_TRANSITION", {
        status: "shipped",
        to: "processing",
      }),
    );

    const error: unknown = await processOrder(api, ID).catch((e: unknown) => e);
    expect(isApiError(error, "INVALID_TRANSITION")).toBe(true);
    expect(error).toMatchObject({
      status: 409,
      details: { status: "shipped" },
    });
  });

  it("never retries a POST, even on 503", async () => {
    const { api, fetchMock } = setup(() => apiError(503, "UNAVAILABLE"), {
      retries: 3,
    });

    await expect(completeOrder(api, ID)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: order }));
    const controller = new AbortController();

    const pending = shipOrder(
      api,
      ID,
      { tracking_number: "JNE012345" },
      {
        signal: controller.signal,
      },
    );
    controller.abort();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
