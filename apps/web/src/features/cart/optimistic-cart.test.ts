import { EMPTY_CART } from "@goshop/shared";
import type { Money } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { cartLine, cartOf } from "@/test/fake-api.ts";
import { withAddedItem } from "./optimistic-cart.ts";

const price = (amount: number): Money => ({ amount, currency: "IDR" });

describe("withAddedItem", () => {
  it("raises the count and the subtotal of an empty cart, adding no line", () => {
    const next = withAddedItem(
      EMPTY_CART,
      { variant_id: "m", quantity: 3 },
      price(89_000),
    );

    expect(next).toEqual({
      lines: [],
      item_count: 3,
      subtotal: { amount: 267_000, currency: "IDR" },
    });
  });

  it("adds to the line that already holds the variant, leaving the others", () => {
    const other = cartLine("l", { quantity: 1 });
    const cart = cartOf([cartLine("m", { quantity: 2 }), other]);

    const next = withAddedItem(
      cart,
      { variant_id: "m", quantity: 3 },
      price(89_000),
    );

    expect(next.item_count).toBe(6);
    expect(next.subtotal.amount).toBe(6 * 89_000);
    expect(next.lines[0]).toMatchObject({
      variant_id: "m",
      quantity: 5,
      line_total: { amount: 5 * 89_000, currency: "IDR" },
    });
    expect(next.lines[1]).toBe(other);
  });

  it("prices the line with its own unit price and the subtotal with the given one", () => {
    const cart = cartOf([
      cartLine("m", { quantity: 1, unit_price: price(80_000) }),
    ]);

    const next = withAddedItem(
      cart,
      { variant_id: "m", quantity: 1 },
      price(90_000),
    );

    expect(next.lines[0]?.line_total.amount).toBe(160_000);
    expect(next.subtotal.amount).toBe(80_000 + 90_000);
  });

  it("does not change the cart it is given", () => {
    const cart = cartOf([cartLine("m", { quantity: 2 })]);
    const before = structuredClone(cart);

    withAddedItem(cart, { variant_id: "m", quantity: 1 }, price(89_000));

    expect(cart).toEqual(before);
  });
});
