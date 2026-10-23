import { describe, expect, it } from "vitest";
import type { Money } from "../api/types.ts";
import { formatRupiah } from "./money.ts";

const NBSP = " ";
const idr = (amount: number): Money => ({ amount, currency: "IDR" });

describe("formatRupiah", () => {
  it("writes Rp, a non-breaking space and dots between thousands", () => {
    expect(formatRupiah(idr(89_000))).toBe(`Rp${NBSP}89.000`);
    expect(formatRupiah(idr(89_000))).not.toContain(" ");
  });

  it.each([
    [0, "0"],
    [500, "500"],
    [1_250_000, "1.250.000"],
    [12_345_678_900, "12.345.678.900"],
  ])("formats %i", (amount, digits) => {
    expect(formatRupiah(idr(amount))).toBe(`Rp${NBSP}${digits}`);
  });

  it("never shows decimals", () => {
    expect(formatRupiah(idr(89_000.4))).toBe(`Rp${NBSP}89.000`);
    expect(formatRupiah(idr(1_999.5))).toBe(`Rp${NBSP}2.000`);
  });
});
