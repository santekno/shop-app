import { z } from "./zod.ts";
import { characters, hasNoNul } from "./text.ts";
import type { ProductWrite } from "../api/types.ts";

// The body of POST and PUT /v1/admin/products as a Zod schema, mirroring
// api/openapi.yaml (ProductWrite, VariantWrite) and what the API's handler
// checks (apps/api/internal/product/admin.go): the same required fields,
// the same limits in characters (runes, as Go counts them), money as whole
// rupiah in an integer, SKUs trimmed and upper-cased before they are
// checked, unique SKUs and IDs within one product, and `version` with every
// `id`. The dashboard's product form (Bab 12 artikel 03) validates with it
// step by step; the API checks everything again and has the last word.

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_SLUG_MAX_LENGTH = 200;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 5000;
export const PRODUCT_VARIANTS_MAX = 50;
export const VARIANT_SKU_MAX_LENGTH = 64;
export const VARIANT_NAME_MAX_LENGTH = 100;
export const VARIANT_PRICE_MIN = 1;
export const VARIANT_PRICE_MAX = 1_000_000_000;
export const VARIANT_STOCK_MAX = 1_000_000;
export const VARIANT_WEIGHT_MIN_GRAMS = 1;
export const VARIANT_WEIGHT_MAX_GRAMS = 100_000;

/**
 * A sellable variant with this many units or fewer is "low on stock": the
 * dashboard's badges, the product table's "Stok menipis" filter, and the
 * API's `low_stock` (`LowStockThreshold` in
 * apps/api/internal/product/table.go) all mean this number. The contract
 * states it only in prose ("5 units or fewer", AdminProductRow.low_stock
 * and the `low_stock` filter of GET /v1/admin/products), not as a value a
 * client could read, so the two are kept equal by hand: change both, or
 * neither.
 */
export const LOW_STOCK_THRESHOLD = 5;

/** How much of a variant is left: none, a few, or enough. */
export type StockLevel = "out" | "low" | "ok";

/**
 * A variant's stock as a level: 0 is "out", 1 to LOW_STOCK_THRESHOLD is
 * "low", more is "ok". "Out" is low too, for the API's `low_stock`; the
 * dashboard shows the stronger of the two.
 */
export const stockLevel = (stock: number): StockLevel => {
  if (stock <= 0) return "out";
  return stock <= LOW_STOCK_THRESHOLD ? "low" : "ok";
};

/** The statuses a product can be saved with. Only `active` is on sale. */
export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

/** A slug: lower-case letters and digits, in words joined by single hyphens. */
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const INVALID_TEXT = "Berisi karakter yang tidak didukung.";

/** A required text field: trimmed, 1 to `max` characters, no NUL. */
const text = (max: number, empty: string, tooLong: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .refine((value) => characters(value) <= max, tooLong)
    .refine(hasNoNul, INVALID_TEXT);

/**
 * A whole number written in a form field. An <input> gives a string, and
 * a seller in Indonesia writes thousands with dots ("89.000"), so a string
 * may be digits ("89000") or digits in groups of three joined by dots
 * ("89.000", "1.250.000"). Anything else ("89,5", "89.5", "Rp 89000",
 * "-1") is refused rather than guessed at: "89.5" read as 895 or 89 would
 * put a wrong price on sale. A number (a form that already holds one) is
 * taken as it is. The output is a number, what the API wants.
 */
const WHOLE_NUMBER_PATTERN = /^(\d+|\d{1,3}(\.\d{3})+)$/;

const wholeNumber = (
  min: number,
  max: number,
  messages: { empty: string; invalid: string; range: string },
) =>
  z
    .union([z.number(), z.string()])
    .transform((value, ctx) => {
      if (typeof value === "number") return value;
      const digits = value.trim();
      if (digits === "") {
        ctx.addIssue({ code: "custom", message: messages.empty });
        return z.NEVER;
      }
      if (!WHOLE_NUMBER_PATTERN.test(digits)) {
        ctx.addIssue({ code: "custom", message: messages.invalid });
        return z.NEVER;
      }
      return Number(digits.replaceAll(".", ""));
    })
    .pipe(
      z
        .number({ error: messages.invalid })
        .int(messages.invalid)
        .min(min, messages.range)
        .max(max, messages.range),
    );

/** 1000000 → "1.000.000", for the messages. */
const formatNumber = (value: number) => value.toLocaleString("id-ID");

/**
 * One variant of the product: what a buyer picks (a size, a colour), with
 * its own SKU, price, stock and weight.
 *
 * `id` and `version` belong to an existing variant (PUT): the form keeps
 * them from GET /v1/admin/products/{id} and sends them back unchanged. A
 * new variant has neither, and on create no variant has an `id`. `version`
 * is what lets the API refuse a save made from a stale form (409
 * VERSION_CONFLICT).
 */
export const variantSchema = z
  .object({
    // z.guid(), not z.uuid(): the API's rule is any 8-4-4-4-12 hex ID.
    id: z.guid().optional(),
    version: z.number().int().min(0).optional(),
    sku: z
      .string()
      .trim()
      .transform((sku) => sku.toUpperCase())
      .pipe(
        z
          .string()
          .min(1, "Isi SKU varian, misalnya KPH-M.")
          .refine(
            (value) => characters(value) <= VARIANT_SKU_MAX_LENGTH,
            `SKU paling panjang ${VARIANT_SKU_MAX_LENGTH} karakter.`,
          )
          .refine(hasNoNul, INVALID_TEXT),
      ),
    name: text(
      VARIANT_NAME_MAX_LENGTH,
      "Isi nama varian, misalnya M atau Merah.",
      `Nama varian paling panjang ${VARIANT_NAME_MAX_LENGTH} karakter.`,
    ),
    price: wholeNumber(VARIANT_PRICE_MIN, VARIANT_PRICE_MAX, {
      empty: "Isi harga varian.",
      invalid:
        "Tulis harga dalam rupiah tanpa koma, misalnya 89000 atau 89.000.",
      range: `Harga antara Rp${formatNumber(VARIANT_PRICE_MIN)} dan Rp${formatNumber(VARIANT_PRICE_MAX)}.`,
    }),
    stock: wholeNumber(0, VARIANT_STOCK_MAX, {
      empty: "Isi stok varian (0 jika habis).",
      invalid: "Tulis stok sebagai bilangan bulat, misalnya 12.",
      range: `Stok antara 0 dan ${formatNumber(VARIANT_STOCK_MAX)}.`,
    }),
    weight_grams: wholeNumber(
      VARIANT_WEIGHT_MIN_GRAMS,
      VARIANT_WEIGHT_MAX_GRAMS,
      {
        empty: "Isi berat varian dalam gram, untuk ongkos kirim.",
        invalid: "Tulis berat dalam gram sebagai bilangan bulat, misalnya 250.",
        range: `Berat antara ${formatNumber(VARIANT_WEIGHT_MIN_GRAMS)} dan ${formatNumber(VARIANT_WEIGHT_MAX_GRAMS)} gram.`,
      },
    ),
  })
  .refine(
    (variant) => variant.id === undefined || variant.version !== undefined,
    {
      path: ["version"],
      message: "Versi varian hilang. Muat ulang produk, lalu simpan lagi.",
    },
  );

/**
 * The whole product, as POST and PUT /v1/admin/products take it. The
 * output is a ProductWrite (`satisfies` checks it against the type
 * generated from the contract); the input may hold the numbers as the
 * strings a form field gives.
 */
export const productSchema = z.object({
  category_id: z.guid({ error: "Pilih kategori produk." }),
  slug: z
    .string()
    .trim()
    .min(1, "Isi slug, alamat produk di toko, misalnya kaos-polos-hitam.")
    .max(
      PRODUCT_SLUG_MAX_LENGTH,
      `Slug paling panjang ${PRODUCT_SLUG_MAX_LENGTH} karakter.`,
    )
    .regex(
      PRODUCT_SLUG_PATTERN,
      "Slug hanya berisi huruf kecil, angka dan tanda hubung di antara kata, misalnya kaos-polos-hitam.",
    ),
  name: text(
    PRODUCT_NAME_MAX_LENGTH,
    "Isi nama produk.",
    `Nama produk paling panjang ${PRODUCT_NAME_MAX_LENGTH} karakter.`,
  ),
  description: z
    .string()
    .trim()
    .refine(
      (value) => characters(value) <= PRODUCT_DESCRIPTION_MAX_LENGTH,
      `Deskripsi paling panjang ${formatNumber(PRODUCT_DESCRIPTION_MAX_LENGTH)} karakter.`,
    )
    .refine(hasNoNul, INVALID_TEXT)
    .default(""),
  status: z.enum(PRODUCT_STATUSES, { error: "Pilih status produk." }),
  variants: z
    .array(variantSchema)
    .min(1, "Tambahkan paling sedikit satu varian.")
    .max(
      PRODUCT_VARIANTS_MAX,
      `Paling banyak ${PRODUCT_VARIANTS_MAX} varian per produk.`,
    )
    .superRefine(
      (variants, ctx) => {
        // The API refuses a SKU or an ID twice in one request; say which.
        // This runs even when some variant has another error (`when`
        // below), so the seller sees every problem of the step at once.
        // Such a variant may still hold its raw input, hence the checks.
        const skus = new Set<string>();
        const ids = new Set<string>();
        variants.forEach((variant: unknown, index) => {
          const { sku, id } = (variant ?? {}) as {
            sku?: unknown;
            id?: unknown;
          };
          const key = typeof sku === "string" ? sku.trim().toUpperCase() : "";
          if (key !== "") {
            if (skus.has(key)) {
              ctx.addIssue({
                code: "custom",
                path: [index, "sku"],
                message: "SKU ini sudah dipakai varian lain di produk ini.",
              });
            }
            skus.add(key);
          }
          if (typeof id === "string") {
            if (ids.has(id)) {
              ctx.addIssue({
                code: "custom",
                path: [index, "id"],
                message: "Varian ini tercantum dua kali.",
              });
            }
            ids.add(id);
          }
        });
      },
      { when: (payload) => Array.isArray(payload.value) },
    ),
}) satisfies z.ZodType<ProductWrite>;

/** What the product form holds: numbers may still be strings. */
export type ProductInput = z.input<typeof productSchema>;
/** One variant as the form holds it. */
export type VariantInput = z.input<typeof variantSchema>;

/**
 * A slug made from a product's name, for the form to suggest: "Kaos Polos
 * Hitam" → "kaos-polos-hitam", "Kopi Gayo 250 gr (Biji)" →
 * "kopi-gayo-250-gr-biji". Accents are dropped ("Café" → "cafe"), anything
 * that is not a letter or a digit separates words, and the result is cut
 * to the slug's length at a word boundary when it can be. An empty string
 * when the name has no letter or digit at all.
 */
export const toProductSlug = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= PRODUCT_SLUG_MAX_LENGTH) return slug;
  const cut = slug.slice(0, PRODUCT_SLUG_MAX_LENGTH);
  // The cut fell between two words: keep it whole. Inside a word: drop
  // that word's start (one long word with no hyphen is kept as cut).
  if (slug[PRODUCT_SLUG_MAX_LENGTH] === "-") return cut;
  return cut.replace(/-[^-]*$/, "");
};
