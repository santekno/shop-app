import { VARIANT_STOCK_MAX, isApiError, stockLevel } from "@goshop/shared";
import type {
  AdminProductRow,
  AdminVariant,
  StockAdjustment,
  StockLevel,
} from "@goshop/shared";

/**
 * Stock, the dashboard's pure parts (Bab 12 artikel 05): levels for the
 * badges, and the quick stock change on the edit page. No React here.
 *
 * Stock is the one value of a product that changes without anyone in the
 * dashboard touching it: a checkout takes units (Bab 5), a cancelled or
 * expired order gives them back, a quick change in the Stok panel adds or
 * counts. Each of those writes bumps the variant's `version` (never the
 * product's), which is how a save from the form finds out (409
 * VERSION_CONFLICT, `details.variant_id`) instead of writing over it.
 */

/**
 * A product row's level, from the API's totals: "out" when its sellable
 * variants have nothing left together, "low" when the API says some
 * variant is at the response's `low_stock_threshold` or fewer
 * (`low_stock`), else "ok".
 */
export const productStockLevel = (
  row: Pick<AdminProductRow, "stock" | "variant_count" | "low_stock">,
): StockLevel => {
  if (row.variant_count > 0 && row.stock === 0) return "out";
  return row.low_stock ? "low" : "ok";
};

/** The units of these variants together. */
export const totalStock = (variants: readonly Pick<AdminVariant, "stock">[]) =>
  variants.reduce((sum, variant) => sum + variant.stock, 0);

/** How many of these variants are out, and how many low. */
export const stockSummary = (
  variants: readonly Pick<AdminVariant, "stock">[],
) => ({
  out: variants.filter((variant) => stockLevel(variant.stock) === "out").length,
  low: variants.filter((variant) => stockLevel(variant.stock) === "low").length,
});

/**
 * How the seller changes one variant's stock:
 *
 * - `add`: a difference ("20 masuk", "-2 rusak"), applied by the API to
 *   the stock as it is when the change runs. Sales in between are kept:
 *   10 units, 2 sold meanwhile, +20 received is 28.
 * - `set`: a count ("I counted 15"), written only while the stock is
 *   still the one the seller saw (`expected`). If a sale or a
 *   cancellation moved it since, the seller decides.
 */
export type StockChange =
  | { mode: "add"; variantId: string; amount: number }
  | {
      mode: "set";
      variantId: string;
      value: number;
      /**
       * The stock on screen when the seller started. The API compares it
       * with the stock, not the version: a price edit in between changes
       * the version but takes nothing from anyone's count.
       */
      expected: number;
    };

/**
 * The body of POST …/variants/{variant_id}/stock-adjustments: `{ delta }`
 * for a difference, `{ set, expected }` for a count. The API does the
 * arithmetic and the check in one guarded statement, so nothing is read
 * first and nothing else of the product is sent.
 */
export const toStockAdjustment = (change: StockChange): StockAdjustment =>
  change.mode === "add"
    ? { delta: change.amount }
    : { set: change.value, expected: change.expected };

/** What a quick stock change ended with. */
export type StockChangeResult =
  /** Saved: the variant as the API answered it, its stock before and after. */
  | { kind: "saved"; variant: AdminVariant; from: number; to: number }
  /** `set`, and the stock was no longer `expected` (STOCK_CHANGED). */
  | { kind: "moved"; expected: number; current: number; wanted: number }
  /**
   * `add` would take the stock below 0, or raise it above the maximum
   * (STOCK_OUT_OF_RANGE). Only an increase is capped: a stock a cancellation
   * restored above the maximum can still be lowered.
   */
  | { kind: "out-of-range"; current: number; to: number }
  /** The variant is not sellable any more (VARIANT_ARCHIVED, or NOT_FOUND). */
  | { kind: "gone" };

/**
 * The result of a 200: the variant after the change. The stock before is
 * exact, not a guess: a delta was added to it in the same statement, and
 * a count was written only while it was `expected`.
 */
export const savedStockChange = (
  change: StockChange,
  variant: AdminVariant,
): StockChangeResult => ({
  kind: "saved",
  variant,
  from: change.mode === "add" ? variant.stock - change.amount : change.expected,
  to: variant.stock,
});

/**
 * The result of an error the seller can act on, or `undefined` for one
 * they cannot (a network error, a 500: the caller shows a message).
 *
 * The `stock` in a 409's details is the stock right after the refused
 * change. It is shown, and offered as the next `expected`, but never used
 * to compute a write: the next change is sent and checked again.
 */
export const stockChangeErrorResult = (
  change: StockChange,
  error: unknown,
): StockChangeResult | undefined => {
  if (isApiError(error, "VARIANT_ARCHIVED", "NOT_FOUND")) {
    return { kind: "gone" };
  }
  if (!isApiError(error, "STOCK_CHANGED", "STOCK_OUT_OF_RANGE")) {
    return undefined;
  }
  const stock = error.details.stock;
  if (typeof stock !== "number") return undefined;
  if (error.code === "STOCK_CHANGED" && change.mode === "set") {
    return {
      kind: "moved",
      expected: change.expected,
      current: stock,
      wanted: change.value,
    };
  }
  if (error.code === "STOCK_OUT_OF_RANGE" && change.mode === "add") {
    return { kind: "out-of-range", current: stock, to: stock + change.amount };
  }
  return undefined;
};

/** A whole number as typed: "15", "1.250", "+20", "-3". */
const SIGNED_NUMBER_PATTERN = /^([+-]?)(\d+|\d{1,3}(\.\d{3})+)$/;

/** What a stock field holds: a number, or why it is not one. */
export type ParsedStockInput =
  { ok: true; value: number } | { ok: false; message: string };

/**
 * Reads the quick change's input the way the product form reads numbers
 * (digits, or groups of three joined by dots, the Indonesian way). `add`
 * takes a sign and refuses 0 (nothing to do) and more than
 * VARIANT_STOCK_MAX either way (the API's limit on `delta`); `set` takes
 * 0 to VARIANT_STOCK_MAX and no sign.
 */
export const parseStockInput = (
  mode: StockChange["mode"],
  raw: string,
): ParsedStockInput => {
  const text = raw.trim().replaceAll(" ", "");
  if (text === "") {
    return {
      ok: false,
      message:
        mode === "add"
          ? "Isi jumlahnya, misalnya 20 untuk barang masuk atau -2 untuk barang rusak."
          : "Isi jumlah stok hasil hitung, 0 jika habis.",
    };
  }
  const match = SIGNED_NUMBER_PATTERN.exec(text);
  if (match === null) {
    return {
      ok: false,
      message: "Tulis bilangan bulat, misalnya 20, -2 atau 1.250.",
    };
  }
  const sign = match[1] ?? "";
  const size = Number((match[2] ?? "").replaceAll(".", ""));
  if (mode === "set") {
    if (sign !== "") {
      return {
        ok: false,
        message:
          "Stok tidak bertanda. Untuk menambah atau mengurangi, pilih “Tambah atau kurangi”.",
      };
    }
    if (size > VARIANT_STOCK_MAX) {
      return {
        ok: false,
        message: `Stok paling banyak ${VARIANT_STOCK_MAX.toLocaleString("id-ID")}.`,
      };
    }
    return { ok: true, value: size };
  }
  if (size === 0) {
    return { ok: false, message: "Isi jumlah selain 0." };
  }
  if (size > VARIANT_STOCK_MAX) {
    return {
      ok: false,
      message: `Perubahan paling banyak ${VARIANT_STOCK_MAX.toLocaleString("id-ID")}.`,
    };
  }
  return { ok: true, value: sign === "-" ? -size : size };
};
