import { isApiError } from "@goshop/shared";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

/** "1000000000" → "1.000.000.000": the API's limits, as a reader writes them. */
const formatNumber = (digits: string) => Number(digits).toLocaleString("id-ID");

/**
 * Indonesian text for the API's field messages. The API writes `details`
 * in English (apps/api/internal/httpapi/validate.go and the auth policy);
 * the contract calls them safe to show, so a message missing from this
 * list is shown as the API wrote it. Nothing here decides what happens
 * next: that is always the error `code`. These lines only choose words.
 */
const FIELD_MESSAGES: readonly [RegExp, (match: RegExpMatchArray) => string][] =
  [
    [/^is required$/, () => "Wajib diisi."],
    [
      /^must be between (\d+) and (\d+) characters$/,
      ([, low = "", high = ""]) => `Harus ${low} sampai ${high} karakter.`,
    ],
    [
      /^must be at least (\d+) characters$/,
      ([, low = ""]) => `Minimal ${low} karakter.`,
    ],
    [
      /^must be at most (\d+) characters$/,
      ([, high = ""]) => `Paling panjang ${high} karakter.`,
    ],
    [
      /^must be an email address/,
      () => "Masukkan alamat email yang benar, misalnya budi@example.com.",
    ],
    [
      /^must contain only ASCII characters$/,
      () => "Gunakan huruf tanpa aksen, angka dan tanda baca biasa saja.",
    ],
    [/^must not be only spaces$/, () => "Tidak boleh hanya berisi spasi."],
    [
      /^is too common/,
      () =>
        "Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.",
    ],
    // Addresses (Bab 11 artikel 02): the sdk's Indonesian rules.
    [
      /^must be an Indonesian phone number/,
      () =>
        "Masukkan nomor telepon Indonesia, misalnya 081234567890 atau +6281234567890.",
    ],
    [
      /^must be a 5-digit Indonesian postal code$/,
      () =>
        "Kode pos terdiri dari 5 angka dan tidak diawali 0, misalnya 40111.",
    ],
    [
      /^must be valid UTF-8 text without NUL characters$/,
      () => "Berisi karakter yang tidak didukung.",
    ],
    // Products (Bab 12 artikel 03): numbers, choices, slugs and SKUs.
    [
      /^must be between (\d+) and (\d+)$/,
      ([, low = "", high = ""]) =>
        `Harus antara ${formatNumber(low)} dan ${formatNumber(high)}.`,
    ],
    [
      /^must be at least (\d+)$/,
      ([, low = ""]) => `Minimal ${formatNumber(low)}.`,
    ],
    [
      /^must be at most (\d+)$/,
      ([, high = ""]) => `Paling besar ${formatNumber(high)}.`,
    ],
    [/^must be one of: /, () => "Pilih salah satu pilihan yang tersedia."],
    [
      /^must be lower-case letters and digits in words joined by single hyphens$/,
      () =>
        "Slug hanya berisi huruf kecil, angka dan tanda hubung di antara kata, misalnya kaos-polos-hitam.",
    ],
    [
      /^is used by another variant in this request$/,
      () => "SKU ini sudah dipakai varian lain di produk ini.",
    ],
    [/^is invalid$/, () => "Isinya tidak valid."],
  ];

/** The Indonesian text for one of the API's field messages. */
export const fieldMessage = (apiText: string): string => {
  for (const [pattern, text] of FIELD_MESSAGES) {
    const match = apiText.match(pattern);
    if (match !== null) return text(match);
  }
  return apiText;
};

/**
 * Puts a 400 VALIDATION_FAILED's `details` on the form's fields.
 *
 * The API answers `{"code":"VALIDATION_FAILED","details":{"password":
 * "is too common; …"}}`, one entry per invalid field, named as in the
 * request body: the same names the form registered. setError marks each
 * field invalid with its message, exactly as a client-side rule would, so
 * TextField shows it under the input (aria-describedby) and the first one
 * gets the focus. Only the form's own `fields` are taken; an entry for
 * anything else (such as "body") is left to the caller.
 *
 * Returns whether any field got an error.
 */
export const setApiFieldErrors = <T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly FieldPath<T>[],
): boolean => {
  if (!isApiError(error, "VALIDATION_FAILED")) return false;
  let applied = false;
  for (const field of fields) {
    const detail = error.details[field];
    if (typeof detail !== "string") continue;
    setError(
      field,
      { type: "server", message: fieldMessage(detail) },
      { shouldFocus: !applied },
    );
    applied = true;
  }
  return applied;
};
