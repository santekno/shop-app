import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { adminProduct, adminVariant } from "@/test/fixtures.ts";
import {
  PRODUCT_FORM_STEPS,
  REVIEW_STEP,
  emptyProductForm,
  emptyVariant,
  productToFormValues,
  saveErrorMessage,
  stepOfField,
  toProductApiErrors,
  variantsToArchive,
} from "./product-form.ts";

const apiError = (
  status: number,
  code: string,
  details?: Record<string, unknown>,
) => new ApiError({ status, code, message: "x", details });

describe("the steps", () => {
  it("are Info dasar, Varian & harga and Tinjau, the last one checking nothing", () => {
    expect(PRODUCT_FORM_STEPS.map((step) => step.title)).toEqual([
      "Info dasar",
      "Varian & harga",
      "Tinjau",
    ]);
    expect(PRODUCT_FORM_STEPS[2].fields).toEqual([]);
    expect(REVIEW_STEP).toBe(2);
  });

  it.each([
    ["name", 0],
    ["category_id", 0],
    ["description", 0],
    ["variants", 1],
    ["variants.0.sku", 1],
    ["variants.12.weight_grams", 1],
    ["variantsX", 0],
  ])("puts %s on step %d", (field, step) => {
    expect(stepOfField(field)).toBe(step);
  });
});

describe("emptyProductForm and emptyVariant", () => {
  it("starts a draft with one empty variant", () => {
    expect(emptyProductForm()).toEqual({
      category_id: "",
      slug: "",
      name: "",
      description: "",
      status: "draft",
      variants: [{ sku: "", name: "", price: "", stock: "", weight_grams: "" }],
    });
  });

  it("gives a fresh object every call", () => {
    expect(emptyVariant()).not.toBe(emptyVariant());
    expect(emptyProductForm().variants).not.toBe(emptyProductForm().variants);
  });
});

describe("productToFormValues", () => {
  it("keeps the versions and turns numbers into the strings the inputs hold", () => {
    const variant = adminVariant(1, {
      price: { amount: 1_250_000, currency: "IDR" },
      stock: 0,
      weight_grams: 300,
      version: 7,
    });

    expect(
      productToFormValues(adminProduct({ version: 4, variants: [variant] })),
    ).toEqual({
      version: 4,
      category_id: adminProduct().category_id,
      slug: "kaos-polos",
      name: "Kaos Polos",
      description: "Kaos katun.",
      status: "active",
      variants: [
        {
          id: variant.id,
          version: 7,
          sku: variant.sku,
          name: variant.name,
          price: "1250000",
          stock: "0",
          weight_grams: "300",
        },
      ],
    });
  });
});

describe("variantsToArchive", () => {
  const a = {
    id: "a",
    sku: "A",
    name: "A",
    price: "1",
    stock: "1",
    weight_grams: "1",
  };
  const b = { ...a, id: "b", sku: "B" };

  it("lists the loaded variants no longer in the form", () => {
    expect(variantsToArchive([a, b], [b])).toEqual([a]);
  });

  it("ignores a new variant without an id, and nothing removed is nothing", () => {
    const fresh = { ...a, id: undefined };

    expect(variantsToArchive([fresh, b], [b])).toEqual([]);
    expect(variantsToArchive([a, b], [a, b, fresh])).toEqual([]);
  });
});

describe("toProductApiErrors", () => {
  it("puts each VALIDATION_FAILED detail on its field, in Indonesian, [n] read as .n", () => {
    expect(
      toProductApiErrors(
        apiError(400, "VALIDATION_FAILED", {
          name: "is required",
          "variants[1].price": "must be between 1 and 1000000000",
          "variants[0].sku": "is used by another variant in this request",
        }),
      ),
    ).toEqual({
      fields: [
        { name: "name", message: "Wajib diisi." },
        {
          name: "variants.1.price",
          message: "Harus antara 1 dan 1.000.000.000.",
        },
        {
          name: "variants.0.sku",
          message: "SKU ini sudah dipakai varian lain di produk ini.",
        },
      ],
      conflict: false,
    });
  });

  it("puts a detail no input shows on the form, keeping the field ones", () => {
    expect(
      toProductApiErrors(
        apiError(400, "VALIDATION_FAILED", {
          slug: "is invalid",
          version: "is required",
          "variants[0].id": "is invalid",
        }),
      ),
    ).toEqual({
      fields: [{ name: "slug", message: "Isinya tidak valid." }],
      form: "Server menolak data produk. version: Wajib diisi. variants[0].id: Isinya tidak valid.",
      conflict: false,
    });
  });

  it("skips a detail that is not text", () => {
    expect(
      toProductApiErrors(
        apiError(400, "VALIDATION_FAILED", { name: 3, slug: "is invalid" }),
      ),
    ).toEqual({
      fields: [{ name: "slug", message: "Isinya tidak valid." }],
      conflict: false,
    });
  });

  it("gives a general message for VALIDATION_FAILED with no usable detail", () => {
    expect(toProductApiErrors(apiError(400, "VALIDATION_FAILED", {}))).toEqual({
      fields: [],
      form: "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
      conflict: false,
    });
  });

  it("puts UNKNOWN_CATEGORY on the category and SLUG_TAKEN on the slug", () => {
    expect(toProductApiErrors(apiError(422, "UNKNOWN_CATEGORY"))).toEqual({
      fields: [
        {
          name: "category_id",
          message: "Kategori ini sudah tidak ada. Pilih kategori lain.",
        },
      ],
      conflict: false,
    });
    expect(toProductApiErrors(apiError(409, "SLUG_TAKEN"))).toEqual({
      fields: [
        {
          name: "slug",
          message: "Slug ini sudah dipakai produk lain. Pilih slug lain.",
        },
      ],
      conflict: false,
    });
  });

  it("puts SKU_TAKEN on the variant list", () => {
    const result = toProductApiErrors(apiError(409, "SKU_TAKEN"));

    expect(result.fields).toEqual([]);
    expect(result.conflict).toBe(false);
    expect(result.variants).toMatch(
      /^Salah satu SKU sudah dipakai varian lain di toko/,
    );
  });

  it.each([
    ["VERSION_CONFLICT", { product_id: "p" }],
    ["VERSION_CONFLICT", { variant_id: "v" }],
    ["VARIANT_ARCHIVED", { variant_id: "v" }],
  ])("reads 409 %s as a conflict, with no message", (code, details) => {
    expect(toProductApiErrors(apiError(409, code, details))).toEqual({
      fields: [],
      conflict: true,
    });
  });

  it.each([
    [
      "NOT_FOUND",
      apiError(404, "NOT_FOUND"),
      "Produk ini tidak ditemukan lagi. Kembali ke daftar produk.",
    ],
    [
      "a 500",
      apiError(500, "INTERNAL_ERROR"),
      "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
    ],
    [
      "a plain 400 that is not VALIDATION_FAILED",
      apiError(400, "BAD_REQUEST"),
      "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
    ],
  ])("puts anything else (%s) on the form", (_name, error, message) => {
    expect(toProductApiErrors(error)).toEqual({
      fields: [],
      form: message,
      conflict: false,
    });
  });
});

describe("saveErrorMessage", () => {
  it.each([
    [
      apiError(404, "NOT_FOUND"),
      "Produk ini tidak ditemukan lagi. Kembali ke daftar produk.",
    ],
    [apiError(403, "FORBIDDEN"), "Akun Anda tidak boleh mengubah produk."],
    [
      apiError(0, "NETWORK_ERROR"),
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    ],
    [
      apiError(0, "CLIENT_TIMEOUT"),
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      apiError(504, "TIMEOUT"),
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      apiError(429, "RATE_LIMITED"),
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    ],
    [
      new Error("boom"),
      "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
    ],
  ])("says what to do for %s", (error, message) => {
    expect(saveErrorMessage(error)).toBe(message);
  });

  it("uses the caller's fallback for a server error", () => {
    expect(
      saveErrorMessage(apiError(500, "INTERNAL_ERROR"), "Belum diarsipkan."),
    ).toBe("Belum diarsipkan.");
  });
});
