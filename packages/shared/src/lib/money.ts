import type { Money } from "../api/types.ts";

// One formatter for the whole app: building an Intl.NumberFormat is far
// slower than using one, and a price list formats many amounts.
// maximumFractionDigits: 0 because rupiah amounts are whole numbers.
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/**
 * Formats an API Money value for display.
 *
 * The space after "Rp" is a non-breaking space (U+00A0), so a line never
 * breaks between the symbol and the amount.
 *
 * @example
 *   formatRupiah({ amount: 89000, currency: "IDR" }); // "Rp 89.000"
 */
export const formatRupiah = ({ amount }: Money): string =>
  rupiah.format(amount);
