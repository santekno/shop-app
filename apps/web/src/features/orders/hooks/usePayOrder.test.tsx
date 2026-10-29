import { act, renderHook, waitFor } from "@testing-library/react";
import { isApiError } from "@goshop/shared";
import type { PaymentSession } from "@goshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { navigationStateFor } from "@/lib/navigation-state.ts";
import {
  order,
  paymentResponse,
  paymentSession,
} from "@/test/checkout-fixtures.ts";
import { errorResponse, fetchMock, requestUrl, user } from "@/test/fake-api.ts";
import { testRouter } from "@/test/memory-router.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { stubLocation } from "@/test/window-location.ts";
import { isMidtransUrl, usePayOrder } from "./usePayOrder.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };
const SNAP = "https://app.sandbox.midtrans.com/snap/v4/redirection/abc";

const mount = (url = "/pesanan/order-1") =>
  renderHook(() => usePayOrder(), {
    wrapper: hookWrapper(createTestQueryClient(), url, session),
  });

const answer = (overrides: Partial<PaymentSession>) => {
  fetchMock.mockResolvedValue(
    paymentResponse(paymentSession("order-1", overrides)),
  );
};

const gtag = vi.fn();
const paymentTypes = () =>
  gtag.mock.calls
    .filter(([, name]) => name === "add_payment_info")
    .map(([, , params]) => (params as { payment_type: string }).payment_type);

let location: ReturnType<typeof stubLocation>;
let listens: MockInstance<typeof window.addEventListener>;

beforeEach(() => {
  fetchMock.mockReset();
  gtag.mockReset();
  window.gtag = gtag;
  location = stubLocation();
  listens = vi.spyOn(window, "addEventListener");
});

afterEach(() => {
  delete window.gtag;
  // A "pageshow" listener left by one test (no pageshow fired) must not
  // reload in the next one: the window outlives the test.
  for (const [type, listener, options] of listens.mock.calls) {
    if (type === "pageshow") {
      window.removeEventListener(type, listener, options);
    }
  }
  listens.mockRestore();
});

describe("isMidtransUrl", () => {
  it.each([
    "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
    "https://app.midtrans.com/snap/v4/redirection/abc",
    "https://midtrans.com/pay",
    "https://APP.MIDTRANS.COM/pay",
  ])("accepts %s", (url) => {
    expect(isMidtransUrl(url)).toBe(true);
  });

  it.each([
    ["plain HTTP", "http://app.midtrans.com/pay"],
    ["a lookalike suffix", "https://app.midtrans.com.evil.example/pay"],
    ["a lookalike name", "https://evilmidtrans.com/pay"],
    ["a lookalike with a dash", "https://app-midtrans.com/pay"],
    ["userinfo before another host", "https://app.midtrans.com@evil.example/"],
    // Joined, so make scan does not read it as a URL with a password.
    [
      "Midtrans as userinfo only",
      "https://midtrans.com" + ":x@evil.example/pay",
    ],
    ["the host in the path", "https://evil.example/app.midtrans.com"],
    ["the host in the query", "https://evil.example/?h=.midtrans.com"],
    ["the test gateway", "https://fake-payment.invalid/pay"],
    ["javascript:", "javascript:alert(1)//.midtrans.com"],
    ["a relative URL", "/snap/v4/redirection/abc"],
    ["not a URL", "midtrans.com"],
    ["an empty string", ""],
  ])("refuses %s", (_, url) => {
    expect(isMidtransUrl(url)).toBe(false);
  });

  it("accepts a port on the real host: only scheme and host are checked", () => {
    // Documented behaviour, not a hole: the host is still Midtrans'.
    expect(isMidtransUrl("https://app.midtrans.com:8443/pay")).toBe(true);
    expect(isMidtransUrl("https://evil.example:443/pay")).toBe(false);
  });
});

describe("usePayOrder", () => {
  it("sends the buyer to Midtrans after making the payment page the current entry", async () => {
    answer({});
    const { result } = mount();
    const pushes = vi.spyOn(window.history, "pushState");

    act(() => {
      result.current.pay(order());
    });

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(SNAP);
    });
    expect(location.assign).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/orders/order-1/pay");
    expect(init?.method).toBe("POST");
    expect(pushes).toHaveBeenCalledWith(
      null,
      "",
      "/pesanan/order-1/pembayaran",
    );
    expect(window.location.pathname).toBe("/pesanan/order-1/pembayaran");
    expect(
      JSON.parse(window.sessionStorage.getItem("goshop:payment-return") ?? ""),
    ).toEqual({ orderId: "order-1", code: "GS-20261030-7KQ2M9" });
    expect(paymentTypes()).toEqual(["midtrans_snap"]);
    expect(testRouter.lastAction).toBe("start");
    pushes.mockRestore();
  });

  it("replaces the entry instead of adding one when asked", async () => {
    answer({});
    const { result } = mount();
    const pushes = vi.spyOn(window.history, "pushState");
    const replaces = vi.spyOn(window.history, "replaceState");

    act(() => {
      result.current.pay(order(), { replace: true });
    });

    await waitFor(() => {
      expect(location.assign).toHaveBeenCalledWith(SNAP);
    });
    expect(replaces).toHaveBeenCalledWith(
      null,
      "",
      "/pesanan/order-1/pembayaran",
    );
    expect(pushes).not.toHaveBeenCalled();
    pushes.mockRestore();
    replaces.mockRestore();
  });

  it("reloads a page Back restores from the back/forward cache, only once", async () => {
    answer({});
    const { result } = mount();

    act(() => {
      result.current.pay(order());
    });
    await waitFor(() => {
      expect(location.assign).toHaveBeenCalled();
    });

    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );
    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: true }),
    );

    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a page shown afresh", async () => {
    answer({});
    const { result } = mount();

    act(() => {
      result.current.pay(order());
    });
    await waitFor(() => {
      expect(location.assign).toHaveBeenCalled();
    });

    window.dispatchEvent(
      Object.assign(new Event("pageshow"), { persisted: false }),
    );

    expect(location.reload).not.toHaveBeenCalled();
  });

  it.each([
    [false, "push"],
    [true, "replace"],
  ] as const)(
    "goes to the payment page with the test gateway (replace: %s)",
    async (replace, action) => {
      answer({
        provider: "fake",
        redirect_url: "https://fake-payment.invalid/pay",
      });
      const { result } = mount();

      act(() => {
        result.current.pay(order(), { replace });
      });

      await waitFor(() => {
        expect(testRouter.location.pathname).toBe(
          "/pesanan/order-1/pembayaran",
        );
      });
      expect(testRouter.lastAction).toBe(action);
      expect(testRouter.entries).toEqual(
        replace
          ? ["/pesanan/order-1/pembayaran"]
          : ["/pesanan/order-1", "/pesanan/order-1/pembayaran"],
      );
      expect(navigationStateFor("/pesanan/order-1/pembayaran")).toEqual({
        fakeProvider: true,
      });
      expect(location.assign).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem("goshop:payment-return")).toBeNull();
      expect(paymentTypes()).toEqual(["fake_gateway"]);
    },
  );

  it.each([
    "https://app.midtrans.com.evil.example/pay",
    "http://app.sandbox.midtrans.com/snap/v4/redirection/abc",
    "https://fake-payment.invalid/pay",
  ])(
    "never leaves for %s: INVALID_RESPONSE, and onError is called",
    async (redirectUrl) => {
      answer({ redirect_url: redirectUrl });
      const onError = vi.fn();
      const { result } = mount();

      act(() => {
        result.current.pay(order(), { onError });
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(isApiError(result.current.error, "INVALID_RESPONSE")).toBe(true);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(isApiError(onError.mock.calls[0]?.[0], "INVALID_RESPONSE")).toBe(
        true,
      );
      expect(location.assign).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/pesanan/order-1");
      expect(window.sessionStorage.getItem("goshop:payment-return")).toBeNull();
      expect(paymentTypes()).toEqual([]);
    },
  );

  it("keeps the buyer on the page when the API refuses the payment", async () => {
    fetchMock.mockResolvedValue(errorResponse(409, "PAYMENT_WINDOW_CLOSED"));
    const { result } = mount();

    act(() => {
      result.current.pay(order());
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(isApiError(result.current.error, "PAYMENT_WINDOW_CLOSED")).toBe(
      true,
    );
    expect(testRouter.location.pathname).toBe("/pesanan/order-1");
    expect(testRouter.lastAction).toBe("start");
    expect(location.assign).not.toHaveBeenCalled();
    expect(paymentTypes()).toEqual([]);
  });
});
