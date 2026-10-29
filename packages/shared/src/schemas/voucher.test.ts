import { describe, expect, it } from "vitest";
import {
  VOUCHER_CODE_MAX_LENGTH,
  VOUCHER_CODE_MIN_LENGTH,
  voucherSchema,
} from "./voucher.ts";

/** The messages of every issue for `code`, or [] when it is valid. */
const errorsOf = (code: string) => {
  const result = voucherSchema.safeParse({ voucher_code: code });
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("voucherSchema", () => {
  it("has the contract's limits: 3 to 32 characters", () => {
    expect([VOUCHER_CODE_MIN_LENGTH, VOUCHER_CODE_MAX_LENGTH]).toEqual([3, 32]);
  });

  it("sends the code trimmed and in capitals", () => {
    expect(voucherSchema.parse({ voucher_code: "  hemat10 " })).toEqual({
      voucher_code: "HEMAT10",
    });
  });

  it.each(["ABC", "A".repeat(32), "abc123XYZ"])("accepts %s", (code) => {
    expect(errorsOf(code)).toEqual([]);
  });

  it("asks for a code when it is blank, before any other message", () => {
    // The form shows the first message (zodResolver's default).
    expect(errorsOf("   ")[0]).toBe("Masukkan kode voucher.");
  });

  it("refuses a code shorter than 3 characters", () => {
    expect(errorsOf("AB")).toEqual(["Kode voucher paling sedikit 3 karakter."]);
  });

  it("refuses a code longer than 32 characters", () => {
    expect(errorsOf("A".repeat(33))).toEqual([
      "Kode voucher paling panjang 32 karakter.",
    ]);
  });

  it.each(["HEMAT-10", "HEMAT 10", "HÉMAT10", "HEMAT10!"])(
    "refuses %s: letters and digits only",
    (code) => {
      expect(errorsOf(code)).toEqual([
        "Kode voucher hanya berisi huruf dan angka.",
      ]);
    },
  );
});
