import { EMPTY_CART } from "@goshop/shared";
import type { Cart } from "@goshop/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLine,
  cartOf,
  cartResponse,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { selectCartToken, useCartStore } from "../cart-store.ts";
import { useCart } from "./useCart.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const itemCount = (cart: Cart) => cart.item_count;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCart", () => {
  it("gives a guest without a token the empty cart, without a request", async () => {
    const { result } = renderHook(() => useCart(), { wrapper: hookWrapper() });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.data).toBe(EMPTY_CART);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the cart of the current token, and follows a new token", async () => {
    const cart = cartOf([cartLine("m", { quantity: 2 })]);
    fetchMock.mockResolvedValue(cartResponse(cart));
    const { result } = renderHook(
      () => ({ cart: useCart(), token: useCartStore(selectCartToken) }),
      { wrapper: hookWrapper() },
    );

    act(() => {
      useCartStore.getState().setToken("tok");
    });

    await waitFor(() => {
      expect(result.current.cart.data).toEqual(cart);
    });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-Cart-Token"),
    ).toBe("tok");
  });

  it("returns only what select picks", async () => {
    const client = createTestQueryClient();
    client.setQueryData(
      ["cart", null],
      cartOf([cartLine("m", { quantity: 3 })]),
    );

    const { result } = renderHook(() => useCart(itemCount), {
      wrapper: hookWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(3);
    });
  });

  it("forgets a token whose cart is gone and shows the empty cart, not an error", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));
    const { result } = renderHook(
      () => ({ cart: useCart(), token: useCartStore(selectCartToken) }),
      { wrapper: hookWrapper() },
    );

    act(() => {
      useCartStore.getState().setToken("old");
    });

    await waitFor(() => {
      expect(result.current.token).toBeNull();
    });
    expect(result.current.cart.status).toBe("success");
    expect(result.current.cart.data).toEqual(EMPTY_CART);
  });
});
