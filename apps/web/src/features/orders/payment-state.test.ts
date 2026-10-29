import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPaymentReturn,
  paymentPageState,
  rememberPaymentReturn,
} from "./payment-state.ts";

const KEY = "goshop:payment-return";
const remembered = { orderId: "order-1", code: "GS-20261030-7KQ2M9" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rememberPaymentReturn and findPaymentReturn", () => {
  it("finds the order for Midtrans' order_id, the code plus a suffix", () => {
    rememberPaymentReturn(remembered);

    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "")).toEqual(
      remembered,
    );
    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toEqual(remembered);
    expect(findPaymentReturn("GS-20261030-7KQ2M9")).toEqual(remembered);
  });

  it("keeps the entry after reading it (StrictMode reads twice)", () => {
    rememberPaymentReturn(remembered);

    findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX");

    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toEqual(remembered);
  });

  it.each([
    ["another order's code", "GS-20261030-AAAAAA-K3D9QX"],
    ["a code that only starts the same", "GS-20261030-7KQ2M9X-K3D9QX"],
    ["a shorter code", "GS-20261030-7KQ2"],
    ["no order_id at all", null],
  ])("finds nothing for %s", (_, midtransOrderId) => {
    rememberPaymentReturn(remembered);

    expect(findPaymentReturn(midtransOrderId)).toBeNull();
  });

  it("finds nothing when nothing was remembered (another tab)", () => {
    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toBeNull();
  });

  it.each([
    ["not JSON", "{orderId"],
    ["null", "null"],
    ["a string", '"order-1"'],
    ["no code", JSON.stringify({ orderId: "order-1" })],
    ["no orderId", JSON.stringify({ code: "GS-20261030-7KQ2M9" })],
    [
      "a numeric id",
      JSON.stringify({ orderId: 1, code: "GS-20261030-7KQ2M9" }),
    ],
    ["a numeric code", JSON.stringify({ orderId: "order-1", code: 7 })],
  ])("treats a stored entry that is %s as nothing", (_, raw) => {
    window.sessionStorage.setItem(KEY, raw);

    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toBeNull();
  });

  it("drops extra fields of the stored entry", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...remembered, token: "secret" }),
    );

    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toEqual(remembered);
  });

  it("survives blocked storage: nothing remembered, nothing found", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => {
      rememberPaymentReturn(remembered);
    }).not.toThrow();
    expect(findPaymentReturn("GS-20261030-7KQ2M9-K3D9QX")).toBeNull();
  });
});

describe("paymentPageState", () => {
  it("reads the fake gateway and the payment error", () => {
    expect(
      paymentPageState({ fakeProvider: true, payError: "Gagal." }),
    ).toEqual({ fakeProvider: true, payError: "Gagal." });
  });

  it.each([undefined, null, "fakeProvider", 1])("is empty for %s", (state) => {
    expect(paymentPageState(state)).toEqual({});
  });

  it("ignores fields of the wrong type", () => {
    expect(paymentPageState({ fakeProvider: "true", payError: 503 })).toEqual(
      {},
    );
  });
});
