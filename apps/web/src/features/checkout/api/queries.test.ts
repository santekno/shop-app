import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  address,
  addressesResponse,
  preview,
  previewResponse,
  quote,
  quotesResponse,
} from "@/test/checkout-fixtures.ts";
import {
  api,
  cartLine,
  cartOf,
  fetchMock,
  requestUrl,
} from "@/test/fake-api.ts";
import { createTestQueryClient } from "@/test/render.tsx";
import {
  addressesQuery,
  cartSignature,
  checkoutKeys,
  previewQuery,
  shippingQuotesQuery,
} from "./queries.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const lastRequest = () => {
  const call = fetchMock.mock.lastCall;
  if (!call) throw new Error("no request was sent");
  return { url: requestUrl(call[0]), init: call[1] };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("checkoutKeys", () => {
  it("puts the user's id in every key, under ['checkout']", () => {
    const choice = { address_id: "a1" };
    expect(checkoutKeys.all).toEqual(["checkout"]);
    expect(checkoutKeys.user("u1")).toEqual(["checkout", "u1"]);
    expect(checkoutKeys.addresses("u1")).toEqual([
      "checkout",
      "u1",
      "addresses",
    ]);
    expect(checkoutKeys.quotes("u1", "a1")).toEqual([
      "checkout",
      "u1",
      "quotes",
      "a1",
    ]);
    expect(checkoutKeys.previews("u1")).toEqual(["checkout", "u1", "preview"]);
    expect(checkoutKeys.preview("u1", "v1:1:89000", choice)).toEqual([
      "checkout",
      "u1",
      "preview",
      "v1:1:89000",
      choice,
    ]);
  });

  it("lets removing ['checkout', user] reach that user's data only", () => {
    const client = createTestQueryClient();
    client.setQueryData(checkoutKeys.addresses("u1"), "mine");
    client.setQueryData(checkoutKeys.preview("u1", "", {}), "my preview");
    client.setQueryData(checkoutKeys.addresses("u2"), "theirs");

    client.removeQueries({ queryKey: checkoutKeys.user("u1") });

    expect(client.getQueryData(checkoutKeys.addresses("u1"))).toBeUndefined();
    expect(
      client.getQueryData(checkoutKeys.preview("u1", "", {})),
    ).toBeUndefined();
    expect(client.getQueryData(checkoutKeys.addresses("u2"))).toBe("theirs");
  });
});

describe("addressesQuery", () => {
  it("fetches GET /v1/me/addresses under the user's key", async () => {
    fetchMock.mockResolvedValue(addressesResponse([address("a1")]));
    const client = createTestQueryClient();

    const addresses = await client.fetchQuery(addressesQuery(api, "u1"));

    expect(addresses.map((a) => a.id)).toEqual(["a1"]);
    expect(lastRequest().url.pathname).toBe("/v1/me/addresses");
    expect(client.getQueryData(checkoutKeys.addresses("u1"))).toBe(addresses);
  });
});

describe("shippingQuotesQuery", () => {
  it("asks for the quotes to one address", async () => {
    fetchMock.mockResolvedValue(quotesResponse([quote()]));
    const client = createTestQueryClient();

    const quotes = await client.fetchQuery(
      shippingQuotesQuery(api, "u1", "a1"),
    );

    expect(quotes.quotes[0]?.service).toBe("REG");
    const { url } = lastRequest();
    expect(url.pathname).toBe("/v1/checkout/shipping-quotes");
    expect(url.searchParams.get("address_id")).toBe("a1");
  });
});

describe("previewQuery", () => {
  it("POSTs the choice and caches the answer under the cart and the choice", async () => {
    const lines = [cartLine("v1")];
    fetchMock.mockResolvedValue(previewResponse(preview(lines)));
    const client = createTestQueryClient();
    const choice = {
      address_id: "a1",
      courier: "jne",
      service: "REG",
    } as const;

    const answer = await client.fetchQuery(
      previewQuery(api, "u1", "v1:1:89000", choice),
    );

    expect(answer.totals.total.amount).toBe(89_000);
    const { url, init } = lastRequest();
    expect(url.pathname).toBe("/v1/checkout/preview");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(choice);
    expect(
      client.getQueryData(checkoutKeys.preview("u1", "v1:1:89000", choice)),
    ).toBe(answer);
  });
});

describe("cartSignature", () => {
  it("is empty without a cart", () => {
    expect(cartSignature(undefined)).toBe("");
  });

  it("lists each line's variant, quantity and accepted price", () => {
    const cart = cartOf([
      cartLine("v1", { quantity: 2 }),
      cartLine("v2", {
        unit_price: { amount: 120_000, currency: "IDR" },
      }),
    ]);
    expect(cartSignature(cart)).toBe("v1:2:89000,v2:1:120000");
  });

  it("changes when the accepted price changes, not when the current one does", () => {
    const before = cartOf([cartLine("v1")]);
    const repriced = cartOf([
      cartLine("v1", {
        unit_price: { amount: 99_000, currency: "IDR" },
        price_when_added: { amount: 89_000, currency: "IDR" },
      }),
    ]);
    const accepted = cartOf([
      cartLine("v1", { unit_price: { amount: 99_000, currency: "IDR" } }),
    ]);

    expect(cartSignature(repriced)).toBe(cartSignature(before));
    expect(cartSignature(accepted)).toBe("v1:1:99000");
  });
});
