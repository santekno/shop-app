import { describe, expect, it } from "vitest";
import { MAX_QUANTITY, clampQuantity, maxQuantity } from "./quantity.ts";

describe("MAX_QUANTITY", () => {
  it("is 99", () => {
    expect(MAX_QUANTITY).toBe(99);
  });
});

describe("maxQuantity", () => {
  it.each([
    [0, 0],
    [-3, 0],
    [0.9, 0],
    [1, 1],
    [5.7, 5],
    [98, 98],
    [99, 99],
    [100, 99],
    [10_000, 99],
  ])("gives %d in stock a maximum of %d", (stock, max) => {
    expect(maxQuantity(stock)).toBe(max);
  });
});

describe("clampQuantity", () => {
  it.each([
    // [quantity, stock, expected]
    [3, 10, 3],
    [1, 10, 1],
    [0, 10, 1],
    [-2, 10, 1],
    [2.9, 10, 2],
    [7, 5, 5],
    [5, 5, 5],
    [200, 150, 99],
    [99, 1_000, 99],
    [1, 0.5, 0],
  ])("clamps %d with %d in stock to %d", (quantity, stock, expected) => {
    expect(clampQuantity(quantity, stock)).toBe(expected);
  });

  it.each([0, -1])(
    "gives 0 when the stock is %d, whatever was picked",
    (stock) => {
      expect(clampQuantity(5, stock)).toBe(0);
      expect(clampQuantity(1, stock)).toBe(0);
    },
  );
});
