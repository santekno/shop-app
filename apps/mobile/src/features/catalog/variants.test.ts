import { describe, expect, it } from "@jest/globals";
import { formatRupiah } from "@goshop/shared";
import type { ProductVariant } from "@goshop/shared";

import { product } from "@/test/fixtures";
import {
  LOW_STOCK_THRESHOLD,
  isAvailable,
  priceLabel,
  selectedVariant,
  stockLabel,
} from "./variants";

const variant = (id: string, stock: number, amount = 50_000): ProductVariant => ({
  id,
  sku: id,
  name: id,
  price: { amount, currency: "IDR" },
  stock,
});

describe("isAvailable", () => {
  it("is true from 1 unit and false at 0", () => {
    expect(isAvailable(variant("a", 1))).toBe(true);
    expect(isAvailable(variant("a", 0))).toBe(false);
  });
});

describe("selectedVariant", () => {
  const s = variant("s", 3);
  const m = variant("m", 0);
  const l = variant("l", 9);

  it("returns the chosen variant when it can be bought", () => {
    expect(selectedVariant({ variants: [s, m, l] }, "l")).toBe(l);
  });

  it("falls back to the first available when nothing is chosen", () => {
    expect(selectedVariant({ variants: [m, s, l] }, undefined)).toBe(s);
  });

  it("falls back when the chosen variant has sold out", () => {
    expect(selectedVariant({ variants: [s, m, l] }, "m")).toBe(s);
  });

  it("falls back when the chosen id is not in the product any more", () => {
    expect(selectedVariant({ variants: [s, l] }, "gone")).toBe(s);
  });

  it("is undefined when every variant is sold out", () => {
    expect(selectedVariant({ variants: [m, variant("x", 0)] }, "m")).toBeUndefined();
  });

  it("is undefined when the product has no variant", () => {
    expect(selectedVariant({ variants: [] }, "m")).toBeUndefined();
  });
});

describe("priceLabel", () => {
  it("is the variant's own price when one is selected", () => {
    const p = product("Kaos", { price_from: { amount: 50_000, currency: "IDR" } });

    expect(priceLabel(p, variant("a", 1, 70_000))).toBe(
      formatRupiah({ amount: 70_000, currency: "IDR" }),
    );
  });

  it("says 'Mulai' with the lowest price when the variants differ and none is selected", () => {
    const p = product("Kaos", {
      price_from: { amount: 50_000, currency: "IDR" },
      variants: [variant("a", 0, 50_000), variant("b", 0, 70_000)],
    });

    expect(priceLabel(p, undefined)).toBe(
      `Mulai ${formatRupiah({ amount: 50_000, currency: "IDR" })}`,
    );
  });

  it("is the plain price when every variant costs the same", () => {
    const p = product("Kaos", {
      price_from: { amount: 50_000, currency: "IDR" },
      variants: [variant("a", 0, 50_000), variant("b", 0, 50_000)],
    });

    expect(priceLabel(p, undefined)).toBe(
      formatRupiah({ amount: 50_000, currency: "IDR" }),
    );
  });
});

describe("stockLabel", () => {
  it("is 'Stok habis' for no variant and for 0 units", () => {
    expect(stockLabel(undefined)).toBe("Stok habis");
    expect(stockLabel(variant("a", 0))).toBe("Stok habis");
  });

  it("counts the units up to the threshold", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
    expect(stockLabel(variant("a", 1))).toBe("Stok tinggal 1");
    expect(stockLabel(variant("a", 5))).toBe("Stok tinggal 5");
  });

  it("is 'Stok tersedia' above the threshold", () => {
    expect(stockLabel(variant("a", 6))).toBe("Stok tersedia");
  });
});
