import { VARIANT_STOCK_MAX, stockLevel } from "@goshop/shared";
import type {
  AdminProduct,
  AdminProductRow,
  AdminVariant,
  ProductWrite,
  StockLevel,
} from "@goshop/shared";

/**
 * Stock, the dashboard's pure parts (Bab 12 artikel 05): levels for the
 * badges, and the quick stock change on the edit page. No React here.
 *
 * Stock is the one value of a product that changes without anyone in the
 * dashboard touching it: a checkout takes units (Bab 5), a cancelled or
 * expired order gives them back. Each of those writes bumps the variant's
 * `version`, which is how a save from the dashboard finds out (409
 * VERSION_CONFLICT) instead of writing over it.
 */

/**
 * A product row's level, from the API's totals: "out" when its sellable
 * variants have nothing left together, "low" when the API says some
 * variant is at LOW_STOCK_THRESHOLD or fewer (`low_stock`), else "ok".
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
 * A product as the server has it, as the body of PUT: every field as it
 * is, every sellable variant with its `id` and the `version` it was read
 * with. Sent unchanged, it changes nothing but the versions; the quick
 * stock change sends it with one stock changed.
 */
export const productToWrite = (product: AdminProduct): ProductWrite => ({
  category_id: product.category_id,
  slug: product.slug,
  name: product.name,
  description: product.description,
  status: product.status,
  variants: product.variants.map((variant) => ({
    id: variant.id,
    version: variant.version,
    sku: variant.sku,
    name: variant.name,
    price: variant.price.amount,
    stock: variant.stock,
    weight_grams: variant.weight_grams,
  })),
});

/**
 * How the seller changes one variant's stock:
 *
 * - `add`: a difference ("20 masuk", "-2 rusak"), applied to the stock the
 *   server has at the moment of saving. Sales in between are kept: 10
 *   units, 2 sold meanwhile, +20 received is 28.
 * - `set`: a count ("I counted 15"), written as it is, but only if the
 *   stock is still the one the seller saw (`seen`). If a sale or a
 *   cancellation moved it since, the seller decides.
 */
export type StockChange =
  | { mode: "add"; variantId: string; amount: number }
  | {
      mode: "set";
      variantId: string;
      value: number;
      /**
       * The stock on screen when the seller started. Compared with the
       * stock, not the version: a price edit in between changes the
       * version but takes nothing from anyone's count.
       */
      seen: { stock: number };
    };

/** What the quick change will do with the product as it is now. */
export type StockPlan =
  | {
      kind: "write";
      body: ProductWrite;
      variant: AdminVariant;
      from: number;
      to: number;
    }
  /** `set`, and the stock moved since the seller saw it. */
  | { kind: "moved"; variant: AdminVariant; seen: number; wanted: number }
  /** `add` would go below 0 or above the maximum. */
  | { kind: "out-of-range"; variant: AdminVariant; to: number }
  /** The variant is not sellable any more (archived by someone else). */
  | { kind: "gone" };

/**
 * Decides what a quick stock change does, given the product as the server
 * has it right now (`latest`, fetched just before):
 *
 * - The body is `latest` with one stock changed: the other variants, the
 *   name, the price and the status go back exactly as the server has
 *   them, each with its current `version`. Nothing the seller did not
 *   touch is written from an old copy.
 * - `add` is applied to the current stock, so a sale in between is never
 *   undone.
 * - `set` writes only if the stock is still what the seller saw. A
 *   version that changed for another reason (a price edit) with the same
 *   stock does not stop it: nothing anyone did to the stock is lost.
 *
 * The PUT itself still carries the versions: if anything changes between
 * this fetch and the write (milliseconds), the API answers 409 and the
 * caller plans again from a new fetch.
 */
export const planStockChange = (
  change: StockChange,
  latest: AdminProduct,
): StockPlan => {
  const variant = latest.variants.find(({ id }) => id === change.variantId);
  if (variant === undefined) return { kind: "gone" };
  let to: number;
  if (change.mode === "add") {
    to = variant.stock + change.amount;
    if (to < 0 || to > VARIANT_STOCK_MAX) {
      return { kind: "out-of-range", variant, to };
    }
  } else {
    if (variant.stock !== change.seen.stock) {
      return {
        kind: "moved",
        variant,
        seen: change.seen.stock,
        wanted: change.value,
      };
    }
    to = change.value;
  }
  const body = productToWrite(latest);
  body.variants = body.variants.map((write) =>
    write.id === variant.id ? { ...write, stock: to } : write,
  );
  return { kind: "write", body, variant, from: variant.stock, to };
};

/** A whole number as typed: "15", "1.250", "+20", "-3". */
const SIGNED_NUMBER_PATTERN = /^([+-]?)(\d+|\d{1,3}(\.\d{3})+)$/;

/** What a stock field holds: a number, or why it is not one. */
export type ParsedStockInput =
  { ok: true; value: number } | { ok: false; message: string };

/**
 * Reads the quick change's input the way the product form reads numbers
 * (digits, or groups of three joined by dots, the Indonesian way). `add`
 * takes a sign and refuses 0 (nothing to do); `set` takes 0 to
 * VARIANT_STOCK_MAX and no sign.
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
  return { ok: true, value: sign === "-" ? -size : size };
};
