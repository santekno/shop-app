import { describe, expect, it } from "vitest";
import {
  TRACKING_NUMBER_MAX_LENGTH,
  TRACKING_NUMBER_MIN_LENGTH,
  shipOrderSchema,
} from "./shipment.ts";

const parse = (value: unknown) =>
  shipOrderSchema.safeParse({ tracking_number: value });
const firstMessage = (value: unknown) => {
  const result = parse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
};

describe("shipOrderSchema", () => {
  it.each([
    ["JNE0123456789", "JNE0123456789"],
    ["jne0123456789", "JNE0123456789"],
    ["  sicepat-001  ", "SICEPAT-001"],
    ["AbC-12", "ABC-12"],
    ["x".repeat(40), "X".repeat(40)],
  ])("accepts %j as %j (trimmed, upper case)", (value, expected) => {
    const result = parse(value);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ tracking_number: expected });
  });

  it("is 6 to 40 characters, as the contract says", () => {
    expect(TRACKING_NUMBER_MIN_LENGTH).toBe(6);
    expect(TRACKING_NUMBER_MAX_LENGTH).toBe(40);
  });

  it.each(["", "   "])("asks for the resi when it is %j", (value) => {
    expect(firstMessage(value)).toBe("Masukkan nomor resi dari kurir.");
  });

  it("refuses 5 characters, after trimming", () => {
    expect(firstMessage(" ABC12 ")).toBe(
      "Nomor resi paling sedikit 6 karakter.",
    );
  });

  it("refuses 41 characters", () => {
    expect(firstMessage("A".repeat(41))).toBe(
      "Nomor resi paling panjang 40 karakter.",
    );
  });

  it.each([
    "JNE 0123456",
    "JNE/0123456",
    "JNE.0123456",
    "JNE_0123456",
    "RESIé12345",
  ])("refuses %j: only letters, digits and hyphens", (value) => {
    expect(firstMessage(value)).toBe(
      "Nomor resi hanya berisi huruf, angka dan tanda hubung, tanpa spasi. Salin persis seperti di struk kurir.",
    );
  });

  it("refuses a value that is not text", () => {
    expect(parse(12345678).success).toBe(false);
  });
});
