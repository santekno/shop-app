import { act, renderHook, waitFor } from "@testing-library/react";
import type { CheckoutRequest } from "@goshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cartKeys } from "@/features/cart/api/queries.ts";
import { orderKeys } from "@/features/orders/api/queries.ts";
import {
  address,
  order,
  orderResponse,
  problem,
} from "@/test/checkout-fixtures.ts";
import {
  cartOf,
  detailedErrorResponse,
  errorResponse,
  fetchMock,
  requestUrl,
  user,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { checkoutKeys } from "../api/queries.ts";
import { usePlaceOrder } from "./usePlaceOrder.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

const body: CheckoutRequest = {
  address_id: "a1",
  courier: "jne",
  service: "REG",
};

/** Every POST /v1/checkout sent: its Idempotency-Key and its body. */
const checkouts = () =>
  fetchMock.mock.calls
    .filter(([input]) => requestUrl(input).pathname === "/v1/checkout")
    .map(([, init]) => ({
      key: new Headers(init?.headers).get("Idempotency-Key"),
      body: JSON.parse(String(init?.body)) as unknown,
    }));

const mount = () => {
  const queryClient = createTestQueryClient();
  const { result } = renderHook(() => usePlaceOrder("u1"), {
    wrapper: hookWrapper(queryClient, "/checkout", session),
  });
  return { result, queryClient };
};

const isStale = (
  queryClient: ReturnType<typeof createTestQueryClient>,
  key: readonly unknown[],
) => queryClient.getQueryState(key)?.isInvalidated;

/** Seeds the cache with what a failed or successful checkout touches. */
const seed = (queryClient: ReturnType<typeof createTestQueryClient>) => {
  queryClient.setQueryData(cartKeys.user("u1"), cartOf([]));
  queryClient.setQueryData(checkoutKeys.addresses("u1"), [address("a1")]);
  queryClient.setQueryData(checkoutKeys.preview("u1", "", {}), "preview");
};

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePlaceOrder", () => {
  it("places the order with an Idempotency-Key and hands it to the order cache", async () => {
    const placed = order();
    fetchMock.mockResolvedValue(orderResponse(placed));
    const { result, queryClient } = mount();
    seed(queryClient);

    act(() => {
      result.current.place(body);
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [sent] = checkouts();
    expect(sent?.body).toEqual(body);
    expect(sent?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.current.data?.code).toBe("GS-20261030-7KQ2M9");
    expect(queryClient.getQueryData(orderKeys.detail("u1", placed.id))).toEqual(
      placed,
    );
    // The ordered lines left the cart; the previews priced a cart that is gone.
    expect(isStale(queryClient, cartKeys.user("u1"))).toBe(true);
    expect(
      queryClient.getQueryData(checkoutKeys.preview("u1", "", {})),
    ).toBeUndefined();
    expect(isStale(queryClient, checkoutKeys.addresses("u1"))).toBe(false);
  });

  it("sends the same key when the buyer presses again after an error", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(422, "CART_EMPTY"));
    fetchMock.mockResolvedValueOnce(orderResponse(order()));
    const { result } = mount();

    act(() => {
      result.current.place(body);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    act(() => {
      result.current.place({ ...body });
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [first, second] = checkouts();
    expect(first?.key).toBeTruthy();
    expect(second?.key).toBe(first?.key);
  });

  it("makes a new key when the body changes, and after an order went through", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(422, "VALIDATION_FAILED"));
    fetchMock.mockResolvedValueOnce(orderResponse(order()));
    fetchMock.mockResolvedValueOnce(orderResponse(order({ id: "order-2" })));
    const { result } = mount();

    act(() => {
      result.current.place(body);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    act(() => {
      result.current.place({ ...body, voucher_code: "HEMAT10" });
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    act(() => {
      result.current.place({ ...body, voucher_code: "HEMAT10" });
    });
    await waitFor(() => {
      expect(result.current.data?.id).toBe("order-2");
    });

    const keys = checkouts().map((sent) => sent.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(checkouts()[1]?.body).toEqual({ ...body, voucher_code: "HEMAT10" });
  });

  it.each([
    ["the network failed", () => Promise.reject(new TypeError("offline"))],
    [
      "the same key is still running",
      () => Promise.resolve(errorResponse(409, "IDEMPOTENCY_IN_PROGRESS")),
    ],
    [
      "the courier did not answer",
      () => Promise.resolve(errorResponse(503, "UPSTREAM_UNAVAILABLE")),
    ],
    [
      "a gateway answered 502",
      () => Promise.resolve(errorResponse(502, "INTERNAL_ERROR")),
    ],
  ])("retries with the same key and body when %s", async (_, fail) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementationOnce(fail);
    fetchMock.mockResolvedValueOnce(orderResponse(order()));
    const { result } = mount();

    act(() => {
      result.current.place(body);
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(result.current.isSuccess).toBe(true);
    const sent = checkouts();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.key).toBe(sent[0]?.key);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it("gives up after three retries, waiting longer before each", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(503, "UPSTREAM_UNAVAILABLE")),
    );
    const { result } = mount();

    act(() => {
      result.current.place(body);
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(checkouts()).toHaveLength(1);
    // 1 s, then 2 s, then 4 s.
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(checkouts()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(checkouts()).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(checkouts()).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(checkouts()).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(checkouts()).toHaveLength(4);
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(checkouts()).toHaveLength(4);
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it.each([
    ["CART_EMPTY", 422],
    ["IDEMPOTENCY_KEY_REUSED", 422],
    ["TOO_MANY_PENDING_ORDERS", 409],
    ["INTERNAL_ERROR", 500],
  ])("does not retry %s", async (code, status) => {
    fetchMock.mockResolvedValue(errorResponse(status, code));
    const { result } = mount();

    act(() => {
      result.current.place(body);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(checkouts()).toHaveLength(1);
    expect(result.current.error).toMatchObject({ code });
  });

  it.each([
    [
      "CHECKOUT_PROBLEMS",
      () =>
        detailedErrorResponse(409, "CHECKOUT_PROBLEMS", {
          lines: [problem("v1")],
        }),
    ],
    ["CART_CHANGED", () => errorResponse(409, "CART_CHANGED")],
  ])(
    "fetches the cart and the previews again after %s",
    async (code, respond) => {
      fetchMock.mockResolvedValue(respond());
      const { result, queryClient } = mount();
      seed(queryClient);

      act(() => {
        result.current.place(body);
      });
      await waitFor(() => {
        expect(result.current.error).toMatchObject({ code });
      });

      expect(isStale(queryClient, cartKeys.user("u1"))).toBe(true);
      expect(isStale(queryClient, checkoutKeys.preview("u1", "", {}))).toBe(
        true,
      );
      expect(isStale(queryClient, checkoutKeys.addresses("u1"))).toBe(false);
    },
  );

  it.each([
    ["VALIDATION_FAILED", 400],
    ["SHIPPING_UNAVAILABLE", 422],
  ])(
    "fetches the addresses and quotes again after %s, not the cart",
    async (code, status) => {
      fetchMock.mockResolvedValue(errorResponse(status, code));
      const { result, queryClient } = mount();
      seed(queryClient);

      act(() => {
        result.current.place(body);
      });
      await waitFor(() => {
        expect(result.current.error).toMatchObject({ code });
      });

      expect(isStale(queryClient, checkoutKeys.addresses("u1"))).toBe(true);
      expect(isStale(queryClient, checkoutKeys.preview("u1", "", {}))).toBe(
        true,
      );
      expect(isStale(queryClient, cartKeys.user("u1"))).toBe(false);
    },
  );

  it("refetches nothing after an error that changes nothing", async () => {
    fetchMock.mockResolvedValue(errorResponse(403, "EMAIL_UNVERIFIED"));
    const { result, queryClient } = mount();
    seed(queryClient);

    act(() => {
      result.current.place(body);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(isStale(queryClient, cartKeys.user("u1"))).toBe(false);
    expect(isStale(queryClient, checkoutKeys.addresses("u1"))).toBe(false);
    expect(isStale(queryClient, checkoutKeys.preview("u1", "", {}))).toBe(
      false,
    );
  });
});
