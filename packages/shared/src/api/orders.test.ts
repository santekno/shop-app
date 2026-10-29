import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import { getOrder, listOrders, payOrder, placeOrder } from "./orders.ts";
import type { CheckoutRequest, Order, PaymentSession } from "./types.ts";

const setup = (
  response: (init: RequestInit | undefined) => Response | Promise<Response>,
  { retries = 0, timeoutMs = 60_000 } = {},
) => {
  const fetchMock = vi.fn<typeof fetch>((_, init) =>
    Promise.resolve(response(init)),
  );
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries,
    timeoutMs,
  });
  const call = (index = 0) => {
    const [input, init] = fetchMock.mock.calls[index] ?? [];
    return {
      url: typeof input === "string" ? input : "",
      init,
      headers: new Headers(init?.headers),
    };
  };
  return { api, fetchMock, call };
};

const apiError = (status: number, code: string) =>
  Response.json({ error: { code, message: "boom" } }, { status });

const order = {
  id: "0b6d2a4e-0000-4000-8000-000000000001",
  status: "pending_payment",
  total: { amount: 188_000, currency: "IDR" },
} as unknown as Order;

const checkout: CheckoutRequest = {
  address_id: "addr-1",
  courier: "jne",
  service: "REG",
  voucher_code: "HEMAT10",
};

describe("placeOrder", () => {
  it("POSTs the checkout with its Idempotency-Key and returns the order", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: order }, { status: 201 }),
    );

    await expect(
      placeOrder(api, checkout, { idempotencyKey: "key-1" }),
    ).resolves.toEqual(order);

    expect(call().url).toBe("http://api.test/v1/checkout");
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual(checkout);
    expect(call().headers.get("Idempotency-Key")).toBe("key-1");
  });

  it("returns the original order on a replay of a finished checkout", async () => {
    const { api } = setup(() =>
      Response.json(
        { data: order },
        { status: 201, headers: { "Idempotency-Replayed": "true" } },
      ),
    );

    await expect(
      placeOrder(api, checkout, { idempotencyKey: "key-1" }),
    ).resolves.toEqual(order);
  });

  it.each([
    [409, "IDEMPOTENCY_IN_PROGRESS"],
    [422, "IDEMPOTENCY_KEY_REUSED"],
    [409, "CART_CHANGED"],
    [403, "EMAIL_UNVERIFIED"],
  ])(
    "throws %i %s once: the client never retries the POST",
    async (status, code) => {
      const { api, fetchMock } = setup(() => apiError(status, code), {
        retries: 3,
      });

      const error: unknown = await placeOrder(api, checkout, {
        idempotencyKey: "key-1",
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ status, code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("gives up after its own timeoutMs, not the client's", async () => {
    // A request that never answers until it is aborted.
    const { api } = setup(
      (init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      { timeoutMs: 60_000 },
    );

    const error: unknown = await placeOrder(api, checkout, {
      idempotencyKey: "key-1",
      timeoutMs: 20,
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "CLIENT_TIMEOUT",
      message: "the API did not answer within 20 ms",
    });
  });

  it("uses the client's timeout when none is given", async () => {
    const { api } = setup(
      (init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      { timeoutMs: 15 },
    );

    const error: unknown = await placeOrder(api, checkout, {
      idempotencyKey: "key-1",
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "CLIENT_TIMEOUT",
      message: "the API did not answer within 15 ms",
    });
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));
    const controller = new AbortController();

    const pending = placeOrder(api, checkout, {
      idempotencyKey: "key-1",
      signal: controller.signal,
    });
    controller.abort();

    expect(call().init?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("getOrder", () => {
  it("GETs one order by id and returns it", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await expect(getOrder(api, order.id)).resolves.toEqual(order);

    expect(call().url).toBe(`http://api.test/v1/orders/${order.id}`);
    expect(call().init?.method).toBe("GET");
  });

  it("escapes the id as one path segment", async () => {
    const { api, call } = setup(() => Response.json({ data: order }));

    await getOrder(api, "../me?x=1");

    expect(call().url).toBe("http://api.test/v1/orders/..%2Fme%3Fx%3D1");
  });

  it("throws NOT_FOUND for another buyer's order", async () => {
    const { api } = setup(() => apiError(404, "NOT_FOUND"));

    const error: unknown = await getOrder(api, order.id).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });
});

describe("payOrder", () => {
  const session = {
    id: "pay-1",
    order_id: order.id,
    provider: "fake",
    status: "pending",
    amount: { amount: 188_000, currency: "IDR" },
    token: "snap-token",
    redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/x",
    client_key: "SB-Mid-client-test",
    expires_at: "2026-10-30T01:00:00Z",
    created_at: "2026-10-30T00:00:00Z",
  } satisfies PaymentSession;

  it("POSTs /v1/orders/{id}/pay with no body and returns the payment", async () => {
    const { api, call } = setup(() => Response.json({ data: session }));

    await expect(payOrder(api, order.id)).resolves.toEqual(session);

    expect(call().url).toBe(`http://api.test/v1/orders/${order.id}/pay`);
    expect(call().init?.method).toBe("POST");
    expect(call().init?.body).toBeUndefined();
  });

  it("escapes the id in the path", async () => {
    const { api, call } = setup(() => Response.json({ data: session }));

    await payOrder(api, "a/b");

    expect(call().url).toBe("http://api.test/v1/orders/a%2Fb/pay");
  });

  it.each([
    [409, "INVALID_TRANSITION"],
    [409, "PAYMENT_WINDOW_CLOSED"],
    [503, "PAYMENTS_DISABLED"],
  ])("throws %i %s, never retrying", async (status, code) => {
    const { api, fetchMock } = setup(() => apiError(status, code), {
      retries: 3,
    });

    const error: unknown = await payOrder(api, order.id).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({ status, code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("listOrders", () => {
  const page = {
    data: [order],
    page: { next_cursor: "c2" },
  };

  it("GETs the first page without a cursor or limit and returns the whole page", async () => {
    const { api, call } = setup(() => Response.json(page));

    await expect(listOrders(api)).resolves.toEqual(page);

    expect(call().url).toBe("http://api.test/v1/orders");
    expect(call().init?.method).toBe("GET");
  });

  it("sends the cursor and the limit", async () => {
    const { api, call } = setup(() => Response.json(page));

    await listOrders(api, { cursor: "c2", limit: 10 });

    const url = new URL(call().url);
    expect(url.pathname).toBe("/v1/orders");
    expect(url.searchParams.get("cursor")).toBe("c2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("sends no cursor for null (the first page)", async () => {
    const { api, call } = setup(() => Response.json(page));

    await listOrders(api, { cursor: null });

    expect(new URL(call().url).searchParams.has("cursor")).toBe(false);
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json(page));
    const controller = new AbortController();

    const pending = listOrders(api, {}, { signal: controller.signal });
    controller.abort();

    expect(call().init?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
