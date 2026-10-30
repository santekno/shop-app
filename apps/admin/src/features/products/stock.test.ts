import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { adminVariant } from "@/test/fixtures.ts";
import {
  parseStockInput,
  productStockLevel,
  savedStockChange,
  stockChangeErrorResult,
  stockSummary,
  toStockAdjustment,
  totalStock,
} from "./stock.ts";
import type { StockChange } from "./stock.ts";

const apiError = (code: string, details?: Record<string, unknown>) =>
  new ApiError({ status: 409, code, message: "x", details });

const add = (amount: number): StockChange => ({
  mode: "add",
  variantId: "v-1",
  amount,
});
const set = (value: number, expected: number): StockChange => ({
  mode: "set",
  variantId: "v-1",
  value,
  expected,
});

describe("productStockLevel", () => {
  it.each([
    [
      "no stock left in any variant",
      { stock: 0, variant_count: 2, low_stock: true },
      "out",
    ],
    [
      "a variant running low",
      { stock: 7, variant_count: 2, low_stock: true },
      "low",
    ],
    ["enough stock", { stock: 40, variant_count: 2, low_stock: false }, "ok"],
    [
      "no variant at all",
      { stock: 0, variant_count: 0, low_stock: false },
      "ok",
    ],
  ] as const)("is the row's level for %s", (_name, row, level) => {
    expect(productStockLevel(row)).toBe(level);
  });
});

describe("totalStock and stockSummary", () => {
  const variants = [{ stock: 0 }, { stock: 3 }, { stock: 5 }, { stock: 6 }];

  it("adds every variant's stock", () => {
    expect(totalStock(variants)).toBe(14);
    expect(totalStock([])).toBe(0);
  });

  it("counts the variants out of stock and the ones running low", () => {
    expect(stockSummary(variants)).toEqual({ out: 1, low: 2 });
    expect(stockSummary([{ stock: 100 }])).toEqual({ out: 0, low: 0 });
  });
});

describe("toStockAdjustment", () => {
  it("sends a difference as a delta", () => {
    expect(toStockAdjustment(add(-3))).toEqual({ delta: -3 });
  });

  it("sends a count with the stock it expects", () => {
    expect(toStockAdjustment(set(20, 12))).toEqual({ set: 20, expected: 12 });
  });
});

describe("savedStockChange", () => {
  it("works out the stock before a delta from the stock after it", () => {
    const variant = adminVariant(1, { stock: 17 });

    expect(savedStockChange(add(5), variant)).toEqual({
      kind: "saved",
      variant,
      from: 12,
      to: 17,
    });
  });

  it("starts a count from the stock it expected", () => {
    const variant = adminVariant(1, { stock: 20 });

    expect(savedStockChange(set(20, 12), variant)).toEqual({
      kind: "saved",
      variant,
      from: 12,
      to: 20,
    });
  });
});

describe("stockChangeErrorResult", () => {
  it.each(["VARIANT_ARCHIVED", "NOT_FOUND"])(
    "says the variant is gone for %s",
    (code) => {
      expect(stockChangeErrorResult(add(1), apiError(code))).toEqual({
        kind: "gone",
      });
    },
  );

  it("says a count moved under the seller, with the stock now", () => {
    expect(
      stockChangeErrorResult(
        set(20, 12),
        apiError("STOCK_CHANGED", { stock: 9 }),
      ),
    ).toEqual({ kind: "moved", expected: 12, current: 9, wanted: 20 });
  });

  it("says a difference would leave the allowed range, with where it would end", () => {
    expect(
      stockChangeErrorResult(
        add(-5),
        apiError("STOCK_OUT_OF_RANGE", { stock: 3, min: 0, max: 1_000_000 }),
      ),
    ).toEqual({ kind: "out-of-range", current: 3, to: -2 });
  });

  it.each([
    [
      "STOCK_CHANGED for a delta",
      add(1),
      apiError("STOCK_CHANGED", { stock: 9 }),
    ],
    [
      "STOCK_OUT_OF_RANGE for a count",
      set(20, 12),
      apiError("STOCK_OUT_OF_RANGE", { stock: 9 }),
    ],
    ["no stock in the details", set(20, 12), apiError("STOCK_CHANGED")],
    [
      "a stock that is not a number",
      set(20, 12),
      apiError("STOCK_CHANGED", { stock: "9" }),
    ],
    [
      "a server error",
      add(1),
      new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "x" }),
    ],
    [
      "the network",
      add(1),
      new ApiError({ status: 0, code: "NETWORK_ERROR", message: "x" }),
    ],
    ["a plain Error", add(1), new Error("x")],
  ])(
    "has no answer for %s (the caller shows the error)",
    (_name, change, error) => {
      expect(stockChangeErrorResult(change, error)).toBeUndefined();
    },
  );
});

describe("parseStockInput", () => {
  it.each([
    ["20", 20],
    ["+20", 20],
    ["-3", -3],
    [" 1.250 ", 1_250],
    ["- 2", -2],
    ["1000000", 1_000_000],
    ["-1.000.000", -1_000_000],
  ])("reads %j as a difference of %d", (raw, value) => {
    expect(parseStockInput("add", raw)).toEqual({ ok: true, value });
  });

  it.each([
    ["0", 0],
    ["20", 20],
    ["1.250", 1_250],
    ["1000000", 1_000_000],
  ])("reads %j as a count of %d", (raw, value) => {
    expect(parseStockInput("set", raw)).toEqual({ ok: true, value });
  });

  it("asks for an amount when empty, in each mode's words", () => {
    expect(parseStockInput("add", "  ")).toEqual({
      ok: false,
      message:
        "Isi jumlahnya, misalnya 20 untuk barang masuk atau -2 untuk barang rusak.",
    });
    expect(parseStockInput("set", "")).toEqual({
      ok: false,
      message: "Isi jumlah stok hasil hitung, 0 jika habis.",
    });
  });

  it.each(["abc", "89,5", "1.25", "12.3456", "2e3", "--2", "1,000"])(
    "refuses %j: whole numbers only",
    (raw) => {
      expect(parseStockInput("add", raw)).toEqual({
        ok: false,
        message: "Tulis bilangan bulat, misalnya 20, -2 atau 1.250.",
      });
    },
  );

  it("refuses a difference of 0", () => {
    expect(parseStockInput("add", "0")).toEqual({
      ok: false,
      message: "Isi jumlah selain 0.",
    });
  });

  it("refuses a difference above 1.000.000", () => {
    expect(parseStockInput("add", "+1000001")).toEqual({
      ok: false,
      message: "Perubahan paling banyak 1.000.000.",
    });
  });

  it.each(["+5", "-5"])("refuses a signed count %j", (raw) => {
    expect(parseStockInput("set", raw)).toEqual({
      ok: false,
      message:
        "Stok tidak bertanda. Untuk menambah atau mengurangi, pilih “Tambah atau kurangi”.",
    });
  });

  it("refuses a count above 1.000.000", () => {
    expect(parseStockInput("set", "1.000.001")).toEqual({
      ok: false,
      message: "Stok paling banyak 1.000.000.",
    });
  });
});
