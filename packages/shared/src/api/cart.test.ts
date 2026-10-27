import { describe, expect, it, vi } from "vitest";
import { EMPTY_CART, addCartItem, getCart } from "./cart.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { Cart } from "./types.ts";

const cart: Cart = {
  lines: [
    {
      variant_id: "v1",
      product_id: "p1",
      product_slug: "kaos-polos",
      product_name: "Kaos Polos",
      variant_name: "M",
      sku: "KP-M",
      quantity: 2,
      unit_price: { amount: 89_000, currency: "IDR" },
      price_when_added: { amount: 89_000, currency: "IDR" },
      line_total: { amount: 178_000, currency: "IDR" },
      stock: 5,
      weight_grams: 200,
      problem: null,
    },
  ],
  item_count: 2,
  subtotal: { amount: 178_000, currency: "IDR" },
};

const setup = (response: () => Response) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  const call = () => {
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    return {
      url: typeof input === "string" ? input : "",
      init,
      headers: new Headers(init?.headers),
    };
  };
  return { api, fetchMock, call };
};

describe("EMPTY_CART", () => {
  it("has no lines, no units and a zero IDR subtotal", () => {
    expect(EMPTY_CART).toEqual({
      lines: [],
      item_count: 0,
      subtotal: { amount: 0, currency: "IDR" },
    });
  });
});

describe("getCart", () => {
  it("GETs /v1/cart with the guest cart's token and returns the cart", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await expect(getCart(api, { cartToken: "tok-1" })).resolves.toEqual(cart);

    expect(call().url).toBe("http://api.test/v1/cart");
    expect(call().init?.method).toBe("GET");
    expect(call().headers.get("X-Cart-Token")).toBe("tok-1");
  });

  it.each([
    ["no options", undefined],
    ["a null token", { cartToken: null }],
    ["an empty token", { cartToken: "" }],
  ])("sends no X-Cart-Token for %s", async (_, options) => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await getCart(api, options);

    expect(call().headers.has("X-Cart-Token")).toBe(false);
  });

  it("throws CART_NOT_FOUND for a token the API no longer knows", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "CART_NOT_FOUND", message: "cart not found" } },
        { status: 404 },
      ),
    );

    const error: unknown = await getCart(api, { cartToken: "old" }).catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "CART_NOT_FOUND")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));
    const controller = new AbortController();
    const fetchSignal = () => call().init?.signal;

    const pending = getCart(api, { signal: controller.signal });
    expect(fetchSignal()?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal()?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("addCartItem", () => {
  const item = { variant_id: "v1", quantity: 2 };

  it("POSTs the item as JSON and returns the cart and the new token", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: cart, cart_token: "new-token" }, { status: 201 }),
    );

    await expect(addCartItem(api, item)).resolves.toEqual({
      cart,
      cartToken: "new-token",
    });

    expect(call().url).toBe("http://api.test/v1/cart/items");
    expect(call().init?.method).toBe("POST");
    expect(call().init?.body).toBe('{"variant_id":"v1","quantity":2}');
    expect(call().headers.has("X-Cart-Token")).toBe(false);
  });

  it("sends the token and returns no new one for an existing cart", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await expect(
      addCartItem(api, item, { cartToken: "tok-1" }),
    ).resolves.toEqual({ cart, cartToken: undefined });

    expect(call().headers.get("X-Cart-Token")).toBe("tok-1");
  });

  it("throws the API's conflict, never retrying the POST", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: "INSUFFICIENT_STOCK",
              message: "not enough stock",
              details: { available: 1 },
            },
          },
          { status: 409 },
        ),
      ),
    );
    const api = createApiClient({
      baseUrl: "http://api.test",
      fetch: fetchMock,
      retries: 3,
    });

    const error: unknown = await addCartItem(api, item).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      details: { available: 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
