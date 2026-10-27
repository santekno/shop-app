import { z } from "./zod.ts";

// A voucher code as the contract accepts it (CheckoutPreviewRequest and
// CheckoutRequest: 3–32 letters and digits). The API matches it without
// regard to case; the form sends it in capitals, as the buyer will see it
// on the order.

export const VOUCHER_CODE_MIN_LENGTH = 3;
export const VOUCHER_CODE_MAX_LENGTH = 32;

export const voucherSchema = z.object({
  voucher_code: z
    .string()
    .trim()
    .min(1, "Masukkan kode voucher.")
    .min(
      VOUCHER_CODE_MIN_LENGTH,
      `Kode voucher paling sedikit ${VOUCHER_CODE_MIN_LENGTH} karakter.`,
    )
    .max(
      VOUCHER_CODE_MAX_LENGTH,
      `Kode voucher paling panjang ${VOUCHER_CODE_MAX_LENGTH} karakter.`,
    )
    .regex(/^[A-Za-z0-9]+$/, "Kode voucher hanya berisi huruf dan angka.")
    .transform((code) => code.toUpperCase()),
});

/** What the voucher form holds and what it sends. */
export type VoucherInput = z.input<typeof voucherSchema>;
export type VoucherOutput = z.output<typeof voucherSchema>;
