import { describe, expect, it } from "vitest";
import {
  LOW_STOCK_THRESHOLD,
  VARIANT_STOCK_MAX,
  stockLevel,
} from "./product.ts";

describe("stockLevel", () => {
  it("knows the API's default threshold and the stock maximum", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
    expect(VARIANT_STOCK_MAX).toBe(1_000_000);
  });

  it.each([
    [-1, "out"],
    [0, "out"],
    [1, "low"],
    [5, "low"],
    [6, "ok"],
    [1_000_000, "ok"],
  ] as const)("calls %d %s", (stock, level) => {
    expect(stockLevel(stock)).toBe(level);
  });
});
