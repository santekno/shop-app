import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { AddressCreate } from "../api/types.ts";
import {
  ADDRESS_LABEL_MAX_LENGTH,
  REGION_MAX_LENGTH,
  RECIPIENT_NAME_MAX_LENGTH,
  STREET_MAX_LENGTH,
  addressSchema,
} from "./address.ts";

const valid = {
  label: "Rumah",
  recipient_name: "Budi Santoso",
  phone: "081234567890",
  street: "Jl. Merdeka No. 1, RT 01/RW 02",
  city: "Bandung",
  province: "Jawa Barat",
  postal_code: "40111",
  is_default: false,
};

type Field = keyof typeof valid;

/** The messages of every issue on `field` when it holds `value`. */
const errorsOf = (field: Field, value: unknown) => {
  const result = addressSchema.safeParse({ ...valid, [field]: value });
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
};

describe("addressSchema", () => {
  it("has the contract's AddressCreate as its output", () => {
    expectTypeOf<
      z.output<typeof addressSchema>
    >().toEqualTypeOf<AddressCreate>();
  });

  it("accepts a complete address, its text trimmed", () => {
    const result = addressSchema.parse({
      ...valid,
      label: "  Kantor ",
      city: " Bandung\n",
      postal_code: " 40111 ",
      is_default: true,
    });

    expect(result).toEqual({
      ...valid,
      label: "Kantor",
      city: "Bandung",
      postal_code: "40111",
      is_default: true,
    });
  });

  it("has the API's limits", () => {
    expect([
      ADDRESS_LABEL_MAX_LENGTH,
      RECIPIENT_NAME_MAX_LENGTH,
      STREET_MAX_LENGTH,
      REGION_MAX_LENGTH,
    ]).toEqual([50, 100, 500, 100]);
  });

  it.each<[Field, string]>([
    ["label", "Beri nama alamat ini, misalnya Rumah atau Kantor."],
    ["recipient_name", "Masukkan nama penerima."],
    ["phone", "Masukkan nomor telepon penerima."],
    ["street", "Masukkan alamat lengkap: jalan, nomor rumah, RT/RW."],
    ["city", "Masukkan kota atau kabupaten."],
    ["province", "Masukkan provinsi."],
    ["postal_code", "Masukkan kode pos."],
  ])("asks for %s when it is blank, first", (field, message) => {
    // The form shows a field's first message (zodResolver's default).
    expect(errorsOf(field, "   ")[0]).toBe(message);
  });

  it.each<[Field, number, string]>([
    ["label", 50, "Nama alamat paling panjang 50 karakter."],
    ["recipient_name", 100, "Nama penerima paling panjang 100 karakter."],
    ["street", 500, "Alamat paling panjang 500 karakter."],
    ["city", 100, "Kota paling panjang 100 karakter."],
    ["province", 100, "Provinsi paling panjang 100 karakter."],
  ])("limits %s to %i characters", (field, max, message) => {
    expect(errorsOf(field, "a".repeat(max))).toEqual([]);
    expect(errorsOf(field, "a".repeat(max + 1))).toEqual([message]);
  });

  it("counts characters as the API does (code points), not UTF-16 units", () => {
    // 50 emoji are 100 UTF-16 units, but 50 characters.
    expect(errorsOf("label", "🏠".repeat(50))).toEqual([]);
    expect(errorsOf("label", "🏠".repeat(51))).toEqual([
      "Nama alamat paling panjang 50 karakter.",
    ]);
  });

  it("refuses a NUL character, which the API cannot store", () => {
    expect(errorsOf("street", "Jl. Merdeka\u0000 1")).toEqual([
      "Berisi karakter yang tidak didukung.",
    ]);
  });

  it.each([
    ["081234567890", "081234567890"],
    ["0812-3456-7890", "081234567890"],
    ["0812 3456 7890", "081234567890"],
    ["+6281234567890", "+6281234567890"],
    ["6281234567890", "6281234567890"],
    ["0215550123", "0215550123"],
    ["0227654321", "0227654321"],
  ])("accepts the phone %s and sends %s", (input, sent) => {
    expect(addressSchema.parse({ ...valid, phone: input }).phone).toBe(sent);
  });

  it.each([
    "12345",
    "08123",
    "+1 555 123 4567",
    "08123456789012345",
    "08x2345678",
  ])("refuses the phone %s", (phone) => {
    expect(errorsOf("phone", phone)).toEqual([
      "Masukkan nomor telepon Indonesia, misalnya 081234567890 atau +6281234567890.",
    ]);
  });

  it.each(["01234", "4011", "401111", "4O111"])(
    "refuses the postal code %s",
    (code) => {
      expect(errorsOf("postal_code", code)).toEqual([
        "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
      ]);
    },
  );

  it("needs is_default as a boolean", () => {
    expect(errorsOf("is_default", "true")).toHaveLength(1);
  });
});
