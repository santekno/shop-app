import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_CART,
  addCartItem,
  getCart,
  mergeCart,
  removeCartItem,
  updateCartItem,
} from "./cart.ts";
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

describe("updateCartItem", () => {
  it("PATCHes the line's quantity with the guest token and returns the cart", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await expect(
      updateCartItem(api, "v1", { quantity: 3 }, { cartToken: "tok-1" }),
    ).resolves.toEqual(cart);

    expect(call().url).toBe("http://api.test/v1/cart/items/v1");
    expect(call().init?.method).toBe("PATCH");
    expect(call().init?.body).toBe('{"quantity":3}');
    expect(call().headers.get("X-Cart-Token")).toBe("tok-1");
  });

  it("escapes the variant id as one path segment, and sends no token for a logged-in user", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await updateCartItem(api, "a/b?c", { quantity: 1 });

    expect(call().url).toBe("http://api.test/v1/cart/items/a%2Fb%3Fc");
    expect(call().headers.has("X-Cart-Token")).toBe(false);
  });

  it("throws INSUFFICIENT_STOCK with what is available, never retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: "INSUFFICIENT_STOCK",
              message: "not enough stock",
              details: { available: 2 },
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

    const error: unknown = await updateCartItem(api, "v1", {
      quantity: 5,
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: { available: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("removeCartItem", () => {
  it("DELETEs the line with the guest token and returns the cart that is left", async () => {
    const { api, call } = setup(() => Response.json({ data: EMPTY_CART }));

    await expect(
      removeCartItem(api, "v1", { cartToken: "tok-1" }),
    ).resolves.toEqual(EMPTY_CART);

    expect(call().url).toBe("http://api.test/v1/cart/items/v1");
    expect(call().init?.method).toBe("DELETE");
    expect(call().init?.body).toBeUndefined();
    expect(call().headers.get("X-Cart-Token")).toBe("tok-1");
  });

  it("throws NOT_FOUND for a line that is already gone", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "NOT_FOUND", message: "gone" } },
        { status: 404 },
      ),
    );

    const error: unknown = await removeCartItem(api, "v1").catch(
      (e: unknown) => e,
    );
    expect(isApiError(error, "NOT_FOUND")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));
    const controller = new AbortController();

    const pending = removeCartItem(api, "v1", { signal: controller.signal });
    controller.abort();

    expect(call().init?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("mergeCart", () => {
  it("POSTs the guest token to /v1/cart/merge and returns the user's cart", async () => {
    const { api, call } = setup(() => Response.json({ data: cart }));

    await expect(mergeCart(api, "guest-tok")).resolves.toEqual(cart);

    expect(call().url).toBe("http://api.test/v1/cart/merge");
    expect(call().init?.method).toBe("POST");
    expect(call().headers.get("X-Cart-Token")).toBe("guest-tok");
    expect(call().init?.body).toBeUndefined();
    // An ordinary call: no cookie.
    expect(call().init?.credentials).toBeUndefined();
    expect(call().headers.has("X-GoShop-Client")).toBe(false);
  });

  it("throws CART_NOT_FOUND for a guest cart already merged or gone", async () => {
    const { api } = setup(() =>
      Response.json(
        { error: { code: "CART_NOT_FOUND", message: "gone" } },
        { status: 404 },
      ),
    );

    const error: unknown = await mergeCart(api, "old").catch((e: unknown) => e);
    expect(isApiError(error, "CART_NOT_FOUND")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: cart }));
    const controller = new AbortController();
    const fetchSignal = () => fetchMock.mock.calls[0]?.[1]?.signal;

    const pending = mergeCart(api, "tok", { signal: controller.signal });
    expect(fetchSignal()?.aborted).toBe(false);
    controller.abort();

    expect(fetchSignal()?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("the cart calls send no cookie", () => {
  it("getCart and addCartItem keep fetch's default credentials", async () => {
    const { api, fetchMock } = setup(() => Response.json({ data: cart }));

    await getCart(api, { cartToken: "tok" });
    await addCartItem(api, { variant_id: "v1", quantity: 1 });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBeUndefined();
      expect(new Headers(init?.headers).has("X-GoShop-Client")).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
