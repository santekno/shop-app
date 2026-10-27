import { EMPTY_CART } from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartLine,
  cartOf,
  cartResponse,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { createTestQueryClient } from "@/test/render.tsx";
import { cartKeys, cartQuery } from "./queries.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
});

describe("cartKeys", () => {
  it("keys each guest cart by its token under ['cart']", () => {
    expect(cartKeys.all).toEqual(["cart"]);
    expect(cartKeys.cart("tok")).toEqual(["cart", "tok"]);
    expect(cartKeys.cart(null)).toEqual(["cart", null]);
  });
});

describe("cartQuery", () => {
  it("answers an empty cart without a request when there is no token", async () => {
    const options = cartQuery(null);

    expect(options.queryKey).toEqual(["cart", null]);
    await expect(createTestQueryClient().query(options)).resolves.toBe(
      EMPTY_CART,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches GET /v1/cart with the token", async () => {
    const cart = cartOf([cartLine("m")]);
    fetchMock.mockResolvedValue(cartResponse(cart));

    await expect(
      createTestQueryClient().query(cartQuery("tok")),
    ).resolves.toEqual(cart);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input).toBe("http://api.test/v1/cart");
    expect(new Headers(init?.headers).get("X-Cart-Token")).toBe("tok");
  });

  it("answers an empty cart and calls onCartGone when the token names no cart", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));
    const onCartGone = vi.fn();

    await expect(
      createTestQueryClient().query(cartQuery("old", onCartGone)),
    ).resolves.toBe(EMPTY_CART);
    expect(onCartGone).toHaveBeenCalledTimes(1);
  });

  it("still fails on CART_NOT_FOUND without an onCartGone", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "CART_NOT_FOUND"));

    await expect(
      createTestQueryClient().query(cartQuery("old")),
    ).rejects.toMatchObject({ code: "CART_NOT_FOUND" });
  });

  it("still fails on any other error, without calling onCartGone", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));
    const onCartGone = vi.fn();

    await expect(
      createTestQueryClient().query(cartQuery("tok", onCartGone)),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(onCartGone).not.toHaveBeenCalled();
  });
});
