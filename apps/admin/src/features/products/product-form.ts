import { isApiError } from "@goshop/shared";
import type { AdminProduct, ProductInput, VariantInput } from "@goshop/shared";
import { fieldMessage } from "@/lib/api-form-errors.ts";
import { errorMessage } from "@/lib/error-message.ts";

/**
 * The product form's pure parts (Bab 12 artikel 03): its steps, its empty
 * and loaded values, and how the API's errors land on its fields. No
 * React here, so each piece can be tested on its own.
 */

/** The fields of the first step, in the order they are on screen. */
export const INFO_FIELDS = [
  "name",
  "slug",
  "category_id",
  "status",
  "description",
] as const;

export type InfoField = (typeof INFO_FIELDS)[number];

/** A variant's inputs, in screen order (the form focuses the first invalid one). */
export const VARIANT_FIELDS = [
  "sku",
  "name",
  "price",
  "stock",
  "weight_grams",
] as const;

/** One step of the form: its title and the fields it validates. */
export interface ProductFormStep {
  title: string;
  /** What `trigger` checks before the form moves past this step. */
  fields: readonly (InfoField | "variants")[];
}

/**
 * The three steps. Photos are not a step: a photo belongs to a product
 * that exists, so they are added on the edit page once the product is
 * saved (artikel 04).
 */
export const PRODUCT_FORM_STEPS = [
  { title: "Info dasar", fields: INFO_FIELDS },
  { title: "Varian & harga", fields: ["variants"] },
  { title: "Tinjau", fields: [] },
] as const satisfies readonly ProductFormStep[];

/** The index of the last step, the one that saves. */
export const REVIEW_STEP = PRODUCT_FORM_STEPS.length - 1;

/**
 * The step a field is on: "variants.2.price" and "variants" on the
 * variant step, everything else on the first.
 */
export const stepOfField = (field: string): number =>
  field === "variants" || field.startsWith("variants.") ? 1 : 0;

/** A new, empty variant. No `id`: the API creates it. */
export const emptyVariant = (): VariantInput => ({
  sku: "",
  name: "",
  price: "",
  stock: "",
  weight_grams: "",
});

/**
 * A new product: a draft with one empty variant (the API needs at least
 * one). Draft by default, so a product is never on sale before the seller
 * says so.
 */
export const emptyProductForm = (): ProductInput => ({
  category_id: "",
  slug: "",
  name: "",
  description: "",
  status: "draft",
  variants: [emptyVariant()],
});

/**
 * A loaded product as the form's values. Numbers become the strings an
 * <input> holds; each variant keeps its `id` and `version`, which no input
 * shows but every PUT must send back (the optimistic lock).
 */
export const productToFormValues = (product: AdminProduct): ProductInput => ({
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
    price: String(variant.price.amount),
    stock: String(variant.stock),
    weight_grams: String(variant.weight_grams),
  })),
});

/** A field of the form that has an input, and so can show a message. */
const FIELD_PATTERN =
  /^(name|slug|category_id|status|description|variants\.\d+\.(sku|name|price|stock|weight_grams))$/;

/** What an API error means for the form. */
export interface ProductApiErrors {
  /** Messages for fields that have an input, in the API's order. */
  fields: { name: string; message: string }[];
  /** For the variant list as a whole (a SKU used elsewhere in the shop). */
  variants?: string;
  /** For the whole form, when no field fits. */
  form?: string;
  /** 409 VERSION_CONFLICT: the product changed since the form loaded it. */
  conflict: boolean;
}

/**
 * Sorts an error from POST or PUT /v1/admin/products into the places the
 * form shows it:
 *
 * - VALIDATION_FAILED: one entry per field, named like the request body
 *   ("variants[0].price"), which React Hook Form calls "variants.0.price".
 *   A name with no input (a variant's `id`) goes to the form instead.
 * - UNKNOWN_CATEGORY, SLUG_TAKEN: the field they are about.
 * - SKU_TAKEN: the variant list (the API does not say which SKU).
 * - VERSION_CONFLICT: `conflict`, with a sentence for the form.
 * - anything else: one sentence for the form.
 */
export const toProductApiErrors = (error: unknown): ProductApiErrors => {
  if (isApiError(error, "VALIDATION_FAILED")) {
    const fields: ProductApiErrors["fields"] = [];
    const other: string[] = [];
    for (const [key, detail] of Object.entries(error.details)) {
      if (typeof detail !== "string") continue;
      const name = key.replace(/\[(\d+)\]/g, ".$1");
      if (FIELD_PATTERN.test(name)) {
        fields.push({ name, message: fieldMessage(detail) });
      } else {
        other.push(`${key}: ${fieldMessage(detail)}`);
      }
    }
    if (fields.length > 0 || other.length > 0) {
      return {
        fields,
        conflict: false,
        ...(other.length > 0 && {
          form: `Server menolak data produk. ${other.join(" ")}`,
        }),
      };
    }
  }
  if (isApiError(error, "UNKNOWN_CATEGORY")) {
    return {
      fields: [
        {
          name: "category_id",
          message: "Kategori ini sudah tidak ada. Pilih kategori lain.",
        },
      ],
      conflict: false,
    };
  }
  if (isApiError(error, "SLUG_TAKEN")) {
    return {
      fields: [
        {
          name: "slug",
          message: "Slug ini sudah dipakai produk lain. Pilih slug lain.",
        },
      ],
      conflict: false,
    };
  }
  if (isApiError(error, "SKU_TAKEN")) {
    return {
      fields: [],
      variants:
        "Salah satu SKU sudah dipakai varian lain di toko, termasuk varian yang sudah diarsipkan. Ganti SKU tersebut. (Menukar SKU dua varian dalam sekali simpan juga ditolak: simpan dua kali lewat SKU sementara.)",
      conflict: false,
    };
  }
  if (isApiError(error, "VERSION_CONFLICT")) {
    return {
      fields: [],
      form: "Produk ini berubah sejak Anda membukanya: ada pembelian yang mengurangi stok, atau admin lain menyimpannya. Tidak ada yang tersimpan. Muat ulang data terbaru, lalu ulangi perubahan Anda.",
      conflict: true,
    };
  }
  return { fields: [], form: saveErrorMessage(error), conflict: false };
};

/**
 * A sentence for a write that failed for a reason no field explains.
 * `fallback` is the server-error sentence (the archive button has its own).
 */
export const saveErrorMessage = (
  error: unknown,
  fallback = "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
): string => {
  if (isApiError(error, "NOT_FOUND")) {
    return "Produk ini tidak ditemukan lagi. Kembali ke daftar produk.";
  }
  if (isApiError(error, "FORBIDDEN")) {
    return "Akun Anda tidak boleh mengubah produk.";
  }
  if (
    isApiError(
      error,
      "NETWORK_ERROR",
      "CLIENT_TIMEOUT",
      "TIMEOUT",
      "RATE_LIMITED",
    )
  ) {
    return errorMessage(error);
  }
  return fallback;
};
