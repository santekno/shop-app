import { EMPTY_CART } from "@goshop/shared";
import type { Cart } from "@goshop/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLine,
  cartOf,
  cartResponse,
  deferred,
  errorResponse,
  fetchMock,
  noContentResponse,
  requestUrl,
  user,
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

describe("useCart and the session", () => {
  const cartRequests = () =>
    fetchMock.mock.calls.filter(
      ([input]) => requestUrl(input).pathname === "/v1/cart",
    );

  it("fetches nothing while the session is restored, then the guest's cart", async () => {
    useCartStore.getState().setToken("tok");
    const refresh = deferred<Response>();
    const cart = cartOf([cartLine("m")]);
    fetchMock.mockImplementation((input) =>
      requestUrl(input).pathname === "/v1/auth/web/refresh"
        ? refresh.promise
        : Promise.resolve(cartResponse(cart)),
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: hookWrapper(createTestQueryClient(), "/", "restore"),
    });

    // Whose cart is it? Nobody knows yet: no request, nothing shown.
    await Promise.resolve();
    expect(result.current.status).toBe("pending");
    expect(result.current.fetchStatus).toBe("idle");
    expect(cartRequests()).toHaveLength(0);

    refresh.resolve(noContentResponse());

    await waitFor(() => {
      expect(result.current.data).toEqual(cart);
    });
    const [, init] = cartRequests()[0] ?? [];
    expect(new Headers(init?.headers).get("X-Cart-Token")).toBe("tok");
  });

  it("loads the logged-in user's cart by the access token, under the user's key", async () => {
    // A guest token left over must not be sent with the user's request.
    useCartStore.getState().setToken("guest-tok");
    const cart = cartOf([cartLine("l", { quantity: 2 })]);
    fetchMock.mockResolvedValue(cartResponse(cart));
    const client = createTestQueryClient();
    const { result } = renderHook(() => useCart(), {
      wrapper: hookWrapper(client, "/", {
        user: user({ id: "u1" }),
        accessToken: "a",
      }),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(cart);
    });
    const headers = new Headers(cartRequests()[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer a");
    expect(headers.has("X-Cart-Token")).toBe(false);
    expect(client.getQueryData(["cart", "user", "u1"])).toEqual(cart);
    expect(client.getQueryData(["cart", "guest-tok"])).toBeUndefined();
  });
});
