import type { ShipRequest } from "../api/types.ts";
import { z } from "./zod.ts";

// The body of POST /v1/admin/orders/{id}/ship (ShipRequest): the courier's
// airway bill, the "nomor resi". The contract allows 6–40 letters, digits
// and hyphens (`^[A-Za-z0-9-]{6,40}$`), and the API trims it and stores it
// upper-case; the schema does both first, so the seller sees and sends
// exactly what the order will hold.

export const TRACKING_NUMBER_MIN_LENGTH = 6;
export const TRACKING_NUMBER_MAX_LENGTH = 40;
export const TRACKING_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;

export const shipOrderSchema = z.object({
  tracking_number: z
    .string()
    .trim()
    .min(1, "Masukkan nomor resi dari kurir.")
    .min(
      TRACKING_NUMBER_MIN_LENGTH,
      `Nomor resi paling sedikit ${TRACKING_NUMBER_MIN_LENGTH} karakter.`,
    )
    .max(
      TRACKING_NUMBER_MAX_LENGTH,
      `Nomor resi paling panjang ${TRACKING_NUMBER_MAX_LENGTH} karakter.`,
    )
    .regex(
      TRACKING_NUMBER_PATTERN,
      "Nomor resi hanya berisi huruf, angka dan tanda hubung, tanpa spasi. Salin persis seperti di struk kurir.",
    )
    .transform((value) => value.toUpperCase()),
}) satisfies z.ZodType<ShipRequest>;

/** What the ship form holds, and what it sends. */
export type ShipOrderInput = z.input<typeof shipOrderSchema>;
export type ShipOrderOutput = z.output<typeof shipOrderSchema>;
