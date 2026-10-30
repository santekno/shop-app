import { ApiError } from "@goshop/shared";
import type { VariantInput } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { adminProduct, adminVariant } from "@/test/fixtures.ts";
import {
  productToFormValues,
  toProductApiErrors,
  variantsToArchive,
} from "./product-form.ts";

// The artikel 05 part of product-form.ts: versions in the form, the 409s
// that open the conflict review, and the variants a save archives.

const error = (
  status: number,
  code: string,
  details?: Record<string, unknown>,
) => new ApiError({ status, code, message: "x", details });

describe("productToFormValues (artikel 05)", () => {
  it("carries the product's version and every variant's", () => {
    const values = productToFormValues(
      adminProduct({
        version: 7,
        variants: [
          adminVariant(1, { version: 3 }),
          adminVariant(2, { version: 9 }),
        ],
      }),
    );

    expect(values.version).toBe(7);
    expect(values.variants.map(({ id, version }) => [id, version])).toEqual([
      [adminVariant(1).id, 3],
      [adminVariant(2).id, 9],
    ]);
  });
});

describe("toProductApiErrors, the 409s", () => {
  it.each([
    [
      "VERSION_CONFLICT on the product",
      error(409, "VERSION_CONFLICT", { product_id: "p" }),
    ],
    [
      "VERSION_CONFLICT on a variant",
      error(409, "VERSION_CONFLICT", { variant_id: "v" }),
    ],
    ["VARIANT_ARCHIVED", error(409, "VARIANT_ARCHIVED", { variant_id: "v" })],
  ])(
    "opens the review for %s, with no message of its own",
    (_name, apiError) => {
      expect(toProductApiErrors(apiError)).toEqual({
        fields: [],
        conflict: true,
      });
    },
  );

  it("treats a 400 that only names the version as an ordinary form error", () => {
    expect(
      toProductApiErrors(
        error(400, "VALIDATION_FAILED", { version: "is required" }),
      ),
    ).toEqual({
      fields: [],
      conflict: false,
      form: "Server menolak data produk. version: Wajib diisi.",
    });
  });

  it("does not open the review for another 409", () => {
    expect(toProductApiErrors(error(409, "SKU_TAKEN")).conflict).toBe(false);
  });
});

describe("variantsToArchive", () => {
  const v = (id: string | undefined, sku: string): VariantInput => ({
    ...(id === undefined ? {} : { id, version: 1 }),
    sku,
    name: sku,
    price: "1",
    stock: "1",
    weight_grams: "1",
  });

  it("lists the loaded variants no longer in the form, in loaded order", () => {
    const loaded = [v("a", "A"), v("b", "B"), v("c", "C")];

    expect(variantsToArchive(loaded, [v("b", "B")]).map((x) => x.sku)).toEqual([
      "A",
      "C",
    ]);
  });

  it("is empty when every loaded variant is still there, reordered or edited", () => {
    const loaded = [v("a", "A"), v("b", "B")];

    expect(
      variantsToArchive(loaded, [
        v("b", "B2"),
        v("a", "A"),
        v(undefined, "NEW"),
      ]),
    ).toEqual([]);
  });

  it("never lists a loaded variant without an id", () => {
    expect(variantsToArchive([v(undefined, "X")], [])).toEqual([]);
  });

  it("is empty for a new product", () => {
    expect(variantsToArchive([], [v(undefined, "A")])).toEqual([]);
  });
});
