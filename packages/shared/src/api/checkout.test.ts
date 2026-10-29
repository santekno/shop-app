import { describe, expect, it, vi } from "vitest";
import {
  checkoutProblems,
  getShippingQuotes,
  previewCheckout,
} from "./checkout.ts";
import { createApiClient } from "./client.ts";
import { ApiError, isApiError } from "./errors.ts";
import type {
  CheckoutPreview,
  CheckoutProblem,
  ShippingQuotes,
} from "./types.ts";

const setup = (response: () => Response, retries = 0) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries,
  });
  const call = () => {
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    return { url: typeof input === "string" ? input : "", init };
  };
  return { api, fetchMock, call };
};

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "boom", details } }, { status });

const rupiah = (amount: number) => ({ amount, currency: "IDR" as const });

const quotes = {
  weight_grams: 400,
  quotes: [
    {
      courier: "jne",
      service: "REG",
      fee: rupiah(10_000),
      etd_days_min: 2,
      etd_days_max: 3,
    },
  ],
} as unknown as ShippingQuotes;

describe("getShippingQuotes", () => {
  it("GETs the quotes for one address and returns them", async () => {
    const { api, call } = setup(() => Response.json({ data: quotes }));

    await expect(getShippingQuotes(api, "addr-1")).resolves.toEqual(quotes);

    expect(call().url).toBe(
      "http://api.test/v1/checkout/shipping-quotes?address_id=addr-1",
    );
    expect(call().init?.method).toBe("GET");
  });

  it("escapes the address id in the query", async () => {
    const { api, call } = setup(() => Response.json({ data: quotes }));

    await getShippingQuotes(api, "a&b=c");

    expect(new URL(call().url).searchParams.get("address_id")).toBe("a&b=c");
  });

  it("throws SHIPPING_UNAVAILABLE when no courier serves the address", async () => {
    const { api } = setup(() => apiError(422, "SHIPPING_UNAVAILABLE"));

    const error: unknown = await getShippingQuotes(api, "addr-1").catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "SHIPPING_UNAVAILABLE")).toBe(true);
  });

  it("is a GET, so the client retries a 503", async () => {
    let calls = 0;
    const { api, fetchMock } = setup(() => {
      calls += 1;
      return calls === 1
        ? apiError(503, "UPSTREAM_UNAVAILABLE")
        : Response.json({ data: quotes });
    }, 1);

    await expect(getShippingQuotes(api, "addr-1")).resolves.toEqual(quotes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("previewCheckout", () => {
  const preview = {
    lines: [],
    totals: {
      subtotal: rupiah(178_000),
      shipping_fee: rupiah(10_000),
      discount: rupiah(0),
      total: rupiah(188_000),
    },
    shipping: null,
    voucher: null,
  } as unknown as CheckoutPreview;

  it("POSTs the buyer's choice and returns the API's totals", async () => {
    const { api, call } = setup(() => Response.json({ data: preview }));
    const choice = {
      address_id: "addr-1",
      courier: "jne" as const,
      service: "REG",
      voucher_code: "HEMAT10",
    };

    await expect(previewCheckout(api, choice)).resolves.toEqual(preview);

    expect(call().url).toBe("http://api.test/v1/checkout/preview");
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual(choice);
  });

  it("sends an empty choice as {}", async () => {
    const { api, call } = setup(() => Response.json({ data: preview }));

    await previewCheckout(api, {});

    expect(call().init?.body).toBe("{}");
  });

  it("throws VOUCHER_NOT_APPLICABLE with its reason, never retrying the POST", async () => {
    const { api, fetchMock } = setup(
      () => apiError(422, "VOUCHER_NOT_APPLICABLE", { reason: "min_subtotal" }),
      3,
    );

    const error: unknown = await previewCheckout(api, {
      voucher_code: "HEMAT10",
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "VOUCHER_NOT_APPLICABLE",
      details: { reason: "min_subtotal" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("checkoutProblems", () => {
  const problem: CheckoutProblem = {
    variant_id: "v1",
    sku: "KP-M",
    problem: "insufficient_stock",
    quantity: 3,
    available: 1,
    unit_price: rupiah(89_000),
    price_when_added: rupiah(89_000),
  };

  const conflict = (details: Record<string, unknown>) =>
    new ApiError({
      status: 409,
      code: "CHECKOUT_PROBLEMS",
      message: "checkout problems",
      details,
    });

  it("returns the lines of a 409 CHECKOUT_PROBLEMS", () => {
    const priceChanged: CheckoutProblem = {
      ...problem,
      variant_id: "v2",
      problem: "price_changed",
      unit_price: rupiah(99_000),
    };

    expect(
      checkoutProblems(conflict({ lines: [problem, priceChanged] })),
    ).toEqual([problem, priceChanged]);
  });

  it.each([
    [
      "another code",
      new ApiError({ status: 409, code: "CART_CHANGED", message: "x" }),
    ],
    ["a plain Error", new Error("CHECKOUT_PROBLEMS")],
    ["a non-error", { code: "CHECKOUT_PROBLEMS" }],
    ["undefined", undefined],
  ])("is null for %s", (_, error) => {
    expect(checkoutProblems(error)).toBeNull();
  });

  it("is an empty list when details.lines is not a list", () => {
    expect(checkoutProblems(conflict({}))).toEqual([]);
    expect(checkoutProblems(conflict({ lines: "v1" }))).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "v1"],
    ["an unknown problem", { ...problem, problem: "out_of_print" }],
    ["a missing variant_id", { ...problem, variant_id: undefined }],
    ["a numeric sku", { ...problem, sku: 1 }],
    ["a string quantity", { ...problem, quantity: "3" }],
    ["a missing available", { ...problem, available: undefined }],
    ["a unit_price without amount", { ...problem, unit_price: {} }],
    ["a null price_when_added", { ...problem, price_when_added: null }],
    [
      "a string amount",
      { ...problem, price_when_added: { amount: "89000", currency: "IDR" } },
    ],
  ])("leaves out an entry with %s, keeping the valid ones", (_, bad) => {
    expect(checkoutProblems(conflict({ lines: [bad, problem] }))).toEqual([
      problem,
    ]);
  });
});
