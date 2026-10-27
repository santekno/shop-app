import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  cartLine,
  cartOf,
  cartResponse,
  errorResponse,
  fetchMock,
  requestUrl,
} from "@/test/fake-api.ts";
import { createTestQueryClient } from "@/test/render.tsx";
import { useCartStore } from "./cart-store.ts";
import { forgetUserCarts, mergeGuestCart } from "./merge-guest-cart.ts";

const merged = cartOf([cartLine("m", { quantity: 3 })]);
const guestCart = cartOf([cartLine("m", { quantity: 1 })]);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("mergeGuestCart", () => {
  it("does nothing for a guest without a cart", async () => {
    const queryClient = createTestQueryClient();

    await mergeGuestCart(api, queryClient, "u1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("merges the guest cart, keeps the answer as the user's cart and forgets the token quietly", async () => {
    useCartStore.getState().setToken("guest-tok");
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["cart", "guest-tok"], guestCart);
    fetchMock.mockResolvedValue(cartResponse(merged));

    await mergeGuestCart(api, queryClient, "u1");

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/cart/merge");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Cart-Token")).toBe("guest-tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Straight into the cache under the user's key: no second GET.
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toEqual(merged);
    expect(queryClient.getQueryData(["cart", "guest-tok"])).toBeUndefined();
    expect(useCartStore.getState().token).toBeNull();
    // Nothing was lost: no "cart expired" message.
    expect(useCartStore.getState().cartExpired).toBe(false);
  });

  it("forgets a token the API no longer knows (CART_NOT_FOUND), quietly", async () => {
    useCartStore.getState().setToken("gone");
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["cart", "gone"], guestCart);
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));

    await expect(
      mergeGuestCart(api, queryClient, "u1"),
    ).resolves.toBeUndefined();

    expect(useCartStore.getState().token).toBeNull();
    expect(useCartStore.getState().cartExpired).toBe(false);
    expect(queryClient.getQueryData(["cart", "gone"])).toBeUndefined();
    expect(queryClient.getQueryData(["cart", "user", "u1"])).toBeUndefined();
  });

  it.each([
    [
      "a server error",
      () => Promise.resolve(errorResponse(500, "INTERNAL_ERROR")),
    ],
    ["the network", () => Promise.reject(new TypeError("offline"))],
    ["a rate limit", () => Promise.resolve(errorResponse(429, "RATE_LIMITED"))],
  ])(
    "keeps the token for the next try after %s, and never throws",
    async (_name, reply) => {
      useCartStore.getState().setToken("guest-tok");
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(["cart", "guest-tok"], guestCart);
      fetchMock.mockImplementation(reply);

      await expect(
        mergeGuestCart(api, queryClient, "u1"),
      ).resolves.toBeUndefined();

      expect(useCartStore.getState().token).toBe("guest-tok");
      expect(queryClient.getQueryData(["cart", "guest-tok"])).toEqual(
        guestCart,
      );
      expect(queryClient.getQueryData(["cart", "user", "u1"])).toBeUndefined();
    },
  );
});

describe("forgetUserCarts", () => {
  it("drops every user's cart and leaves the guest carts", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["cart", "user", "u1"], merged);
    queryClient.setQueryData(["cart", "user", "u2"], merged);
    queryClient.setQueryData(["cart", "tok"], guestCart);
    queryClient.setQueryData(["cart", null], guestCart);

    forgetUserCarts(queryClient);

    expect(queryClient.getQueryData(["cart", "user", "u1"])).toBeUndefined();
    expect(queryClient.getQueryData(["cart", "user", "u2"])).toBeUndefined();
    expect(queryClient.getQueryData(["cart", "tok"])).toEqual(guestCart);
    expect(queryClient.getQueryData(["cart", null])).toEqual(guestCart);
  });
});
