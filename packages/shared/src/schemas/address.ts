import { z } from "./zod.ts";
import { characters, hasNoNul } from "./text.ts";
import type { AddressCreate } from "../api/types.ts";

// The rules of POST /v1/me/addresses as a Zod schema, mirroring
// api/openapi.yaml (AddressCreate) and what the API's handler checks
// (apps/api/internal/address/handler.go: every text trimmed, then
// required with a maximum length in characters; the sdk's id_phone and
// id_postal rules). As with the auth forms, the API checks everything
// again and has the last word; the web form and, from Bab 13, the mobile
// app ask the same.

export const ADDRESS_LABEL_MAX_LENGTH = 50;
export const RECIPIENT_NAME_MAX_LENGTH = 100;
export const STREET_MAX_LENGTH = 500;
export const REGION_MAX_LENGTH = 100;

/**
 * An Indonesian phone number as santekno/sdk's validx `id_phone` accepts
 * it (v0.2.0): `0`, `62` or `+62`, then a mobile number (8x), a Jakarta
 * landline (2x) or another area code.
 */
export const ID_PHONE_PATTERN =
  /^(\+62|62|0)(8[1-9][0-9]{6,10}|2[0-9]{6,11}|[3-9][0-9]{5,10})$/;

/** A postal code: five digits, never starting with 0 (`id_postal`). */
export const ID_POSTAL_CODE_PATTERN = /^[1-9][0-9]{4}$/;

/** A required text field: trimmed, 1 to `max` characters, no NUL. */
const text = (max: number, empty: string, tooLong: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .refine((value) => characters(value) <= max, tooLong)
    .refine(hasNoNul, "Berisi karakter yang tidak didukung.");

/**
 * The phone number. A buyer often types it with spaces or dashes
 * ("0812-3456-7890"); the API accepts digits only, so they are removed
 * before the check, and the request carries the cleaned number (the
 * schema's output is what is sent).
 */
const phone = z
  .string()
  .trim()
  .min(1, "Masukkan nomor telepon penerima.")
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        ID_PHONE_PATTERN,
        "Masukkan nomor telepon Indonesia, misalnya 081234567890 atau +6281234567890.",
      ),
  );

/**
 * A new address. `satisfies z.ZodType<AddressCreate>` checks it against
 * the type generated from the contract, as registerSchema does.
 */
export const addressSchema = z.object({
  label: text(
    ADDRESS_LABEL_MAX_LENGTH,
    "Beri nama alamat ini, misalnya Rumah atau Kantor.",
    `Nama alamat paling panjang ${ADDRESS_LABEL_MAX_LENGTH} karakter.`,
  ),
  recipient_name: text(
    RECIPIENT_NAME_MAX_LENGTH,
    "Masukkan nama penerima.",
    `Nama penerima paling panjang ${RECIPIENT_NAME_MAX_LENGTH} karakter.`,
  ),
  phone,
  street: text(
    STREET_MAX_LENGTH,
    "Masukkan alamat lengkap: jalan, nomor rumah, RT/RW.",
    `Alamat paling panjang ${STREET_MAX_LENGTH} karakter.`,
  ),
  city: text(
    REGION_MAX_LENGTH,
    "Masukkan kota atau kabupaten.",
    `Kota paling panjang ${REGION_MAX_LENGTH} karakter.`,
  ),
  province: text(
    REGION_MAX_LENGTH,
    "Masukkan provinsi.",
    `Provinsi paling panjang ${REGION_MAX_LENGTH} karakter.`,
  ),
  postal_code: z
    .string()
    .trim()
    .min(1, "Masukkan kode pos.")
    .regex(
      ID_POSTAL_CODE_PATTERN,
      "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
    ),
  is_default: z.boolean(),
}) satisfies z.ZodType<AddressCreate>;

/** What the address form holds (before cleaning) and what it sends. */
export type AddressInput = z.input<typeof addressSchema>;
