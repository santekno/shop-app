import { ApiError } from "@goshop/shared";
import type { ProductInput } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { adminVariant } from "@/test/fixtures.ts";
import { twoVariantForm, withVariant } from "@/test/products-stock.ts";
import {
  applyMerge,
  conflictCause,
  mergeProduct,
  missingChoices,
  normalizeMergeValue,
  serverChangeCount,
} from "./product-merge.ts";
import type { MergeField, ProductMerge } from "./product-merge.ts";

const V1 = adminVariant(1).id;
const V2 = adminVariant(2).id;
const V3 = adminVariant(3).id;

/** The field of `key` in a merge (info or a kept variant's). */
const fieldOf = (merge: ProductMerge, key: string): MergeField | undefined =>
  [...merge.info, ...merge.variants.flatMap((variant) => variant.fields)].find(
    (field) => field.key === key,
  );

/** base → mine, base → latest, as a merge. */
const merge = (
  edit: (values: ProductInput) => ProductInput,
  server: (values: ProductInput) => ProductInput,
  rejectedVariantId?: string,
) => {
  const base = twoVariantForm();
  return mergeProduct({
    base,
    mine: edit(base),
    latest: server(base),
    rejectedVariantId,
  });
};
const same = (values: ProductInput) => values;

describe("normalizeMergeValue", () => {
  it.each([
    ["name", "  Kaos  ", "Kaos"],
    ["sku", " kph-m ", "KPH-M"],
    ["price", "89.000", "89000"],
    ["price", 89000, "89000"],
    ["stock", "007", "7"],
    ["weight_grams", "1.250", "1250"],
    ["price", "89,5", "89,5"],
    ["stock", "-3", "-3"],
    ["description", undefined, ""],
    ["status", null, ""],
  ] as const)("compares %s %j as %j", (field, value, normal) => {
    expect(normalizeMergeValue(field, value)).toBe(normal);
  });
});

describe("mergeProduct, field by field", () => {
  it("leaves a field neither side changed", () => {
    expect(fieldOf(merge(same, same), "name")).toMatchObject({
      outcome: "unchanged",
      base: "Kaos Polos",
      mine: "Kaos Polos",
      theirs: "Kaos Polos",
    });
  });

  it("takes the server's value when only the server changed it", () => {
    const result = merge(same, (v) => ({ ...v, name: "Kaos Oblong" }));

    expect(fieldOf(result, "name")).toMatchObject({
      outcome: "theirs",
      theirs: "Kaos Oblong",
    });
  });

  it("keeps the seller's value when only the seller changed it", () => {
    const result = merge((v) => ({ ...v, description: "Baru." }), same);

    expect(fieldOf(result, "description")).toMatchObject({
      outcome: "mine",
      mine: "Baru.",
    });
  });

  it("is 'mine', not a conflict, when both made the same change", () => {
    const result = merge(
      (v) => ({ ...v, name: "Kaos Oblong" }),
      (v) => ({ ...v, name: " Kaos Oblong " }),
    );

    expect(fieldOf(result, "name")?.outcome).toBe("mine");
  });

  it("is a conflict when both changed it differently", () => {
    const result = merge(
      (v) => ({ ...v, name: "Kaos A" }),
      (v) => ({ ...v, name: "Kaos B" }),
    );

    expect(fieldOf(result, "name")).toMatchObject({
      outcome: "conflict",
      mine: "Kaos A",
      theirs: "Kaos B",
    });
    expect(fieldOf(result, "name")?.combined).toBeUndefined();
  });

  it("does not count a reformatted number as a change", () => {
    const result = merge((v) => withVariant(v, 0, { price: "89.000" }), same);

    expect(fieldOf(result, `variants.${V1}.price`)?.outcome).toBe("unchanged");
  });

  it("offers the server's stock plus the seller's change for a stock conflict", () => {
    // The seller received 5 (12 → 17) while 2 were sold (12 → 10).
    const result = merge(
      (v) => withVariant(v, 0, { stock: "17" }),
      (v) => withVariant(v, 0, { stock: "10" }),
    );

    expect(fieldOf(result, `variants.${V1}.stock`)).toMatchObject({
      outcome: "conflict",
      base: "12",
      mine: "17",
      theirs: "10",
      combined: "15",
    });
  });

  it.each([
    ["below 0", "2", "1"],
    ["not a whole number", "1.5", "10"],
  ])("offers no combined stock when it would be %s", (_name, mine, theirs) => {
    // 12 → 2 by the seller (−10), 12 → 1 on the server: 1 − 10 < 0.
    const result = merge(
      (v) => withVariant(v, 0, { stock: mine }),
      (v) => withVariant(v, 0, { stock: theirs }),
    );

    expect(fieldOf(result, `variants.${V1}.stock`)?.outcome).toBe("conflict");
    expect(fieldOf(result, `variants.${V1}.stock`)?.combined).toBeUndefined();
  });

  it("offers a combined value for stock only, not for a price both changed", () => {
    // Both are whole numbers, so only the field decides.
    const result = merge(
      (v) => withVariant(v, 0, { price: "99000" }),
      (v) => withVariant(v, 0, { price: "95000" }),
    );

    expect(fieldOf(result, `variants.${V1}.price`)?.outcome).toBe("conflict");
    expect(fieldOf(result, `variants.${V1}.price`)?.combined).toBeUndefined();
  });

  it("offers no combined stock above the maximum", () => {
    const result = merge(
      (v) => withVariant(v, 0, { stock: "1000000" }),
      (v) => withVariant(v, 0, { stock: "13" }),
    );

    expect(fieldOf(result, `variants.${V1}.stock`)?.combined).toBeUndefined();
  });
});

describe("mergeProduct, variant by variant", () => {
  it("keeps a variant all three have, merged field by field", () => {
    const result = merge(same, same);

    expect(
      result.variants.map(({ key, state, label }) => [key, state, label]),
    ).toEqual([
      [V1, "kept", "M (KAOS-M)"],
      [V2, "kept", "L (KAOS-L)"],
    ]);
    expect(result.variants[0]?.fields.map((field) => field.field)).toEqual([
      "sku",
      "name",
      "price",
      "stock",
      "weight_grams",
    ]);
  });

  it("marks a variant the seller removed, with the server's changes and no 'mine'", () => {
    const result = merge(
      (v) => ({ ...v, variants: v.variants.slice(0, 1) }),
      (v) => withVariant(v, 1, { stock: "1" }),
    );
    const removed = result.variants.find((variant) => variant.key === V2);

    expect(removed?.state).toBe("removed-by-me");
    expect(
      removed?.fields.find((field) => field.field === "stock"),
    ).toMatchObject({
      outcome: "theirs",
      mine: "",
      theirs: "1",
    });
  });

  it("marks a variant someone else archived, whether the seller kept or removed it", () => {
    const keptByMe = merge(same, (v) => ({
      ...v,
      variants: v.variants.slice(0, 1),
    }));
    const removedByMe = merge(
      (v) => ({ ...v, variants: v.variants.slice(0, 1) }),
      (v) => ({ ...v, variants: v.variants.slice(0, 1) }),
    );

    expect(keptByMe.variants.find((v) => v.key === V2)).toMatchObject({
      state: "archived-by-them",
      fields: [],
    });
    expect(removedByMe.variants.find((v) => v.key === V2)?.state).toBe(
      "archived-by-them",
    );
  });

  it("marks a variant someone else added, carrying it as the server has it", () => {
    const added = {
      id: V3,
      version: 1,
      sku: "KAOS-XL",
      name: "XL",
      price: "95000",
      stock: "3",
      weight_grams: "300",
    };
    const result = merge(same, (v) => ({
      ...v,
      variants: [...v.variants, added],
    }));

    expect(result.variants.at(-1)).toMatchObject({
      key: V3,
      state: "added-by-them",
      label: "XL (KAOS-XL)",
      latest: added,
    });
  });

  it("marks the seller's own new variants by their place in the list", () => {
    const result = merge(
      (v) => ({
        ...v,
        variants: [
          ...v.variants,
          { sku: "", name: "", price: "", stock: "", weight_grams: "" },
        ],
      }),
      same,
    );

    expect(result.variants.at(-1)).toMatchObject({
      key: "new:2",
      id: undefined,
      state: "new",
      label: "Varian baru",
    });
  });

  it.each([
    [{ name: "", sku: "kaos-x" }, "KAOS-X"],
    [{ name: "Merah", sku: "" }, "Merah"],
  ])("labels a variant from whatever it has: %j", (patch, label) => {
    const result = merge((v) => withVariant(v, 0, patch), same);

    expect(result.variants[0]?.label).toBe(label);
  });

  it("puts the variant the API named first", () => {
    const result = merge(same, same, V2);

    expect(
      result.variants.map((variant) => [variant.key, variant.rejected]),
    ).toEqual([
      [V2, true],
      [V1, false],
    ]);
  });

  it("names a removed variant rejected too", () => {
    const result = merge(
      (v) => ({ ...v, variants: v.variants.slice(0, 1) }),
      (v) => withVariant(v, 1, { stock: "1" }),
      V2,
    );

    expect(result.variants[0]).toMatchObject({
      key: V2,
      rejected: true,
      state: "removed-by-me",
    });
  });
});

describe("missingChoices and serverChangeCount", () => {
  const conflicted = () =>
    merge(
      (v) => withVariant({ ...v, name: "Kaos A" }, 0, { stock: "17" }),
      (v) =>
        withVariant({ ...v, name: "Kaos B", description: "Server." }, 0, {
          stock: "10",
        }),
    );

  it("lists the conflicts not chosen yet", () => {
    const result = conflicted();

    expect(missingChoices(result, {})).toEqual([
      "name",
      `variants.${V1}.stock`,
    ]);
    expect(missingChoices(result, { name: "mine" })).toEqual([
      `variants.${V1}.stock`,
    ]);
    expect(
      missingChoices(result, {
        name: "theirs",
        [`variants.${V1}.stock`]: "combined",
      }),
    ).toEqual([]);
  });

  it("counts every server change: conflicts and the server's own", () => {
    // name (conflict), description (theirs), V1 stock (conflict).
    expect(serverChangeCount(conflicted())).toBe(3);
    expect(serverChangeCount(merge(same, same))).toBe(0);
  });

  it("counts a whole variant once, and a removed variant's server changes", () => {
    const added = {
      id: V3,
      version: 1,
      sku: "X",
      name: "X",
      price: "1",
      stock: "1",
      weight_grams: "1",
    };
    const result = merge(
      (v) => ({
        ...v,
        variants: [
          ...v.variants.slice(0, 1),
          { sku: "", name: "", price: "", stock: "", weight_grams: "" },
        ],
      }),
      (v) => ({
        ...withVariant(v, 1, { stock: "1", price: "1" }),
        variants: [
          ...withVariant(v, 1, { stock: "1", price: "1" }).variants,
          added,
        ],
      }),
    );

    // V2 removed by me with 2 server changes, V3 added by them, the new one 0.
    expect(serverChangeCount(result)).toBe(3);
  });

  it("counts an archived variant as one change", () => {
    expect(
      serverChangeCount(
        merge(same, (v) => ({ ...v, variants: v.variants.slice(0, 1) })),
      ),
    ).toBe(1);
  });
});

describe("applyMerge", () => {
  it("puts the seller's changes on the latest product, with the latest versions", () => {
    const base = twoVariantForm();
    const latest = {
      ...withVariant({ ...base, version: 5, description: "Server." }, 0, {
        version: 3,
        stock: "10",
      }),
    };
    const result = mergeProduct({
      base,
      mine: withVariant({ ...base, name: "Kaos Oblong" }, 1, {
        price: "99000",
      }),
      latest,
    });

    const merged = applyMerge(result, {});

    expect(merged).toMatchObject({
      version: 5,
      name: "Kaos Oblong",
      description: "Server.",
    });
    expect(
      merged.variants.map(({ id, version, stock, price }) => ({
        id,
        version,
        stock,
        price,
      })),
    ).toEqual([
      { id: V1, version: 3, stock: "10", price: "89000" },
      { id: V2, version: 1, stock: "4", price: "99000" },
    ]);
  });

  it("resolves each conflict as chosen, the server's value when none is", () => {
    const base = twoVariantForm();
    const result = mergeProduct({
      base,
      mine: withVariant(
        withVariant({ ...base, name: "Kaos A" }, 0, { stock: "17" }),
        1,
        { stock: "9" },
      ),
      latest: withVariant(
        withVariant({ ...base, name: "Kaos B" }, 0, { stock: "10" }),
        1,
        { stock: "2" },
      ),
    });

    const merged = applyMerge(result, {
      name: "mine",
      [`variants.${V1}.stock`]: "combined",
    });

    expect(merged.name).toBe("Kaos A");
    expect(merged.variants[0]?.stock).toBe("15");
    expect(merged.variants[1]?.stock).toBe("2");
  });

  it("falls back to the server's value for 'combined' without a combined value", () => {
    const base = twoVariantForm();
    const result = mergeProduct({
      base,
      mine: { ...base, name: "A" },
      latest: { ...base, name: "B" },
    });

    expect(applyMerge(result, { name: "combined" }).name).toBe("B");
    expect(applyMerge(result, { name: "theirs" }).name).toBe("B");
  });

  it("drops a variant archived by someone else, keeps the seller's removal, adds theirs at the end", () => {
    const base = twoVariantForm();
    const added = {
      id: V3,
      version: 2,
      sku: "KAOS-XL",
      name: "XL",
      price: "95000",
      stock: "3",
      weight_grams: "300",
    };
    const newOne = {
      sku: "KAOS-S",
      name: "S",
      price: "80000",
      stock: "1",
      weight_grams: "200",
    };
    const result = mergeProduct({
      base,
      // Mine: V1 kept, V2 kept, a new one.
      mine: { ...base, variants: [...base.variants, newOne] },
      // Theirs: V2 archived, V3 added.
      latest: { ...base, variants: [base.variants[0] ?? newOne, added] },
    });

    expect(applyMerge(result, {}).variants.map((v) => v.id ?? v.sku)).toEqual([
      V1,
      "KAOS-S",
      V3,
    ]);
    expect(applyMerge(result, {}).variants.at(-1)).toEqual(added);
  });

  it("leaves a variant the seller removed out", () => {
    const base = twoVariantForm();
    const result = mergeProduct({
      base,
      mine: { ...base, variants: base.variants.slice(1) },
      latest: base,
    });

    expect(applyMerge(result, {}).variants.map((v) => v.id)).toEqual([V2]);
  });
});

describe("conflictCause", () => {
  const conflict = (code: string, details?: Record<string, unknown>) =>
    new ApiError({ status: 409, code, message: "x", details });

  it.each([
    [
      "VARIANT_ARCHIVED with a variant",
      conflict("VARIANT_ARCHIVED", { variant_id: V1 }),
      { kind: "archived", variantId: V1 },
    ],
    [
      "VARIANT_ARCHIVED without one",
      conflict("VARIANT_ARCHIVED"),
      { kind: "archived", variantId: undefined },
    ],
    [
      "VERSION_CONFLICT on a variant",
      conflict("VERSION_CONFLICT", { variant_id: V2 }),
      { kind: "variant", variantId: V2 },
    ],
    [
      "VERSION_CONFLICT on the product",
      conflict("VERSION_CONFLICT", { product_id: "p" }),
      { kind: "product" },
    ],
    [
      "VERSION_CONFLICT without details",
      conflict("VERSION_CONFLICT"),
      { kind: "product" },
    ],
    [
      "a variant_id that is not text",
      conflict("VERSION_CONFLICT", { variant_id: 7 }),
      { kind: "product" },
    ],
    [
      "another error",
      conflict("SLUG_TAKEN", { variant_id: V1 }),
      { kind: "product" },
    ],
    ["not an API error", new Error("x"), { kind: "product" }],
  ])("reads %s", (_name, error, cause) => {
    expect(conflictCause(error)).toEqual(cause);
  });
});
