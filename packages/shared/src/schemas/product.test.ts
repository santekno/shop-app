import { describe, expect, it } from "vitest";
import type { ProductWrite } from "../api/types.ts";
import {
  LOW_STOCK_THRESHOLD,
  PRODUCT_VARIANTS_MAX,
  productSchema,
  stockLevel,
  toProductSlug,
  variantSchema,
} from "./product.ts";

const CATEGORY = "22222222-2222-4222-8222-222222222222";
const VARIANT_ID = "33333333-3333-4333-8333-000000000001";

/** A form's raw variant: numbers as the strings an <input> gives. */
const variant = (overrides: Record<string, unknown> = {}) => ({
  sku: "kph-m",
  name: "M",
  price: "89.000",
  stock: "12",
  weight_grams: "250",
  ...overrides,
});

const product = (overrides: Record<string, unknown> = {}) => ({
  category_id: CATEGORY,
  slug: "kaos-polos",
  name: "Kaos Polos",
  description: "Katun.",
  status: "active",
  variants: [variant()],
  ...overrides,
});

/** The issues of a failed parse, as "path: message". */
const issues = (value: unknown) => {
  const result = productSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
};
const variantIssue = (overrides: Record<string, unknown>) => {
  const result = variantSchema.safeParse(variant(overrides));
  return result.success ? undefined : result.error.issues[0]?.message;
};

describe("productSchema", () => {
  it("turns a valid form into the ProductWrite the API takes", () => {
    const result = productSchema.parse(
      product({
        name: "  Kaos Polos  ",
        slug: " kaos-polos ",
        variants: [variant({ sku: " kph-m ", price: "1.250.000" })],
      }),
    );

    const expected: ProductWrite = {
      category_id: CATEGORY,
      slug: "kaos-polos",
      name: "Kaos Polos",
      description: "Katun.",
      status: "active",
      variants: [
        {
          sku: "KPH-M",
          name: "M",
          price: 1_250_000,
          stock: 12,
          weight_grams: 250,
        },
      ],
    };
    expect(result).toEqual(expected);
  });

  it("defaults the description to empty and keeps an edit's versions", () => {
    const result = productSchema.parse(
      product({
        version: 4,
        description: undefined,
        variants: [variant({ id: VARIANT_ID, version: 2 })],
      }),
    );

    expect(result.description).toBe("");
    expect(result.version).toBe(4);
    expect(result.variants[0]).toMatchObject({ id: VARIANT_ID, version: 2 });
  });

  it.each([
    ["category_id", "", "Pilih kategori produk."],
    ["category_id", "kaos", "Pilih kategori produk."],
    ["name", "   ", "Isi nama produk."],
    ["slug", "", "Isi slug, alamat produk di toko, misalnya kaos-polos-hitam."],
    ["status", "deleted", "Pilih status produk."],
  ])("refuses %s %j", (field, value, message) => {
    expect(issues(product({ [field]: value }))).toContain(
      `${field}: ${message}`,
    );
  });

  it.each(["Kaos X", "a--b", "kaos-", "-kaos", "Kaos"])(
    "refuses the slug %j",
    (slug) => {
      expect(issues(product({ slug }))).toEqual([
        "slug: Slug hanya berisi huruf kecil, angka dan tanda hubung di antara kata, misalnya kaos-polos-hitam.",
      ]);
    },
  );

  it("counts characters as code points: 200 emoji fit a name, 201 do not", () => {
    expect(issues(product({ name: "🔑".repeat(200) }))).toEqual([]);
    expect(issues(product({ name: "🔑".repeat(201) }))).toEqual([
      "name: Nama produk paling panjang 200 karakter.",
    ]);
  });

  it("allows a 200-character slug and a 5000-character description, not one more", () => {
    expect(
      issues(product({ slug: "a".repeat(200), description: "é".repeat(5000) })),
    ).toEqual([]);
    expect(issues(product({ slug: "a".repeat(201) }))).toEqual([
      "slug: Slug paling panjang 200 karakter.",
    ]);
    expect(issues(product({ description: "x".repeat(5001) }))).toEqual([
      "description: Deskripsi paling panjang 5.000 karakter.",
    ]);
  });

  it("refuses a NUL character in text", () => {
    expect(issues(product({ name: "Kaos\u0000" }))).toEqual([
      "name: Berisi karakter yang tidak didukung.",
    ]);
    expect(issues(product({ description: "a\u0000b" }))).toEqual([
      "description: Berisi karakter yang tidak didukung.",
    ]);
    expect(
      issues(product({ variants: [variant({ sku: "A\u0000" })] })),
    ).toEqual(["variants.0.sku: Berisi karakter yang tidak didukung."]);
  });

  it("wants 1 to 50 variants", () => {
    expect(issues(product({ variants: [] }))).toEqual([
      "variants: Tambahkan paling sedikit satu varian.",
    ]);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => variant({ sku: `S-${String(i)}` }));
    expect(issues(product({ variants: many(PRODUCT_VARIANTS_MAX) }))).toEqual(
      [],
    );
    expect(issues(product({ variants: many(51) }))).toEqual([
      "variants: Paling banyak 50 varian per produk.",
    ]);
  });

  it("names a duplicate SKU on the later variant, comparing trimmed and upper-cased", () => {
    expect(
      issues(
        product({
          variants: [variant({ sku: "kph-m" }), variant({ sku: " KPH-M " })],
        }),
      ),
    ).toEqual([
      "variants.1.sku: SKU ini sudah dipakai varian lain di produk ini.",
    ]);
  });

  it("still names a duplicate SKU when another variant has its own error", () => {
    expect(
      issues(
        product({
          variants: [
            variant({ sku: "A" }),
            variant({ sku: "a", price: "" }),
            variant({ sku: "B" }),
          ],
        }),
      ),
    ).toEqual([
      "variants.1.price: Isi harga varian.",
      "variants.1.sku: SKU ini sudah dipakai varian lain di produk ini.",
    ]);
  });

  it("names a variant listed twice", () => {
    expect(
      issues(
        product({
          variants: [
            variant({ id: VARIANT_ID, version: 1, sku: "A" }),
            variant({ id: VARIANT_ID, version: 1, sku: "B" }),
          ],
        }),
      ),
    ).toEqual(["variants.1.id: Varian ini tercantum dua kali."]);
  });

  it("does not crash on variants that are not a list or not objects", () => {
    expect(issues(product({ variants: "x" }))).toHaveLength(1);
    expect(issues(product({ variants: [null] })).length).toBeGreaterThan(0);
  });
});

describe("variantSchema", () => {
  it.each([
    ["89000", 89_000],
    ["89.000", 89_000],
    ["1.250.000", 1_250_000],
    [" 1 ", 1],
    [1_000_000_000, 1_000_000_000],
  ])("reads the price %j as %d", (price, amount) => {
    expect(variantSchema.parse(variant({ price })).price).toBe(amount);
  });

  const notWhole =
    "Tulis harga dalam rupiah tanpa koma, misalnya 89000 atau 89.000.";
  it.each([
    ["", "Isi harga varian."],
    ["89.5", notWhole],
    ["89,5", notWhole],
    ["-1", notWhole],
    [" Rp1", notWhole],
    ["1.25.000", notWhole],
    [89.5, notWhole],
    ["0", "Harga antara Rp1 dan Rp1.000.000.000."],
    ["1.000.000.001", "Harga antara Rp1 dan Rp1.000.000.000."],
  ])("refuses the price %j", (price, message) => {
    expect(variantIssue({ price })).toBe(message);
  });

  it("refuses NaN (the union of number and string turns it away first)", () => {
    expect(
      variantSchema.safeParse(variant({ price: Number.NaN })).success,
    ).toBe(false);
  });

  it("allows stock 0 to 1.000.000 and weight 1 to 100.000 grams", () => {
    expect(
      variantSchema.parse(variant({ stock: "0", weight_grams: "1" })),
    ).toMatchObject({ stock: 0, weight_grams: 1 });
    expect(
      variantSchema.parse(
        variant({ stock: "1.000.000", weight_grams: "100.000" }),
      ),
    ).toMatchObject({ stock: 1_000_000, weight_grams: 100_000 });
    expect(variantIssue({ stock: "1000001" })).toBe(
      "Stok antara 0 dan 1.000.000.",
    );
    expect(variantIssue({ stock: "" })).toBe("Isi stok varian (0 jika habis).");
    expect(variantIssue({ stock: "1,5" })).toBe(
      "Tulis stok sebagai bilangan bulat, misalnya 12.",
    );
    expect(variantIssue({ weight_grams: "0" })).toBe(
      "Berat antara 1 dan 100.000 gram.",
    );
    expect(variantIssue({ weight_grams: "" })).toBe(
      "Isi berat varian dalam gram, untuk ongkos kirim.",
    );
    expect(variantIssue({ weight_grams: "2,5" })).toBe(
      "Tulis berat dalam gram sebagai bilangan bulat, misalnya 250.",
    );
  });

  it("upper-cases and trims the SKU, then checks 64 characters", () => {
    expect(variantSchema.parse(variant({ sku: "  abc-1 " })).sku).toBe("ABC-1");
    expect(variantSchema.parse(variant({ sku: "a".repeat(64) })).sku).toBe(
      "A".repeat(64),
    );
    expect(variantIssue({ sku: "a".repeat(65) })).toBe(
      "SKU paling panjang 64 karakter.",
    );
    expect(variantIssue({ sku: "   " })).toBe(
      "Isi SKU varian, misalnya KPH-M.",
    );
  });

  it("checks the variant's name: required, 100 characters", () => {
    expect(variantIssue({ name: " " })).toBe(
      "Isi nama varian, misalnya M atau Merah.",
    );
    expect(variantIssue({ name: "x".repeat(101) })).toBe(
      "Nama varian paling panjang 100 karakter.",
    );
  });

  it("wants a version with an id, under that field", () => {
    const result = variantSchema.safeParse(variant({ id: VARIANT_ID }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["version"]);
    expect(result.error?.issues[0]?.message).toBe(
      "Versi varian hilang. Muat ulang produk, lalu simpan lagi.",
    );
    expect(
      variantSchema.safeParse(variant({ id: "bukan-uuid", version: 1 }))
        .success,
    ).toBe(false);
    expect(variantSchema.safeParse(variant({ version: 1 })).success).toBe(true);
  });
});

describe("toProductSlug", () => {
  it.each([
    ["Kaos Polos Hitam", "kaos-polos-hitam"],
    ["Kopi Gayo 250 gr (Biji)", "kopi-gayo-250-gr-biji"],
    ["Café Crème", "cafe-creme"],
    ["  --Halo!!--  ", "halo"],
    ["Kaos — Edisi 2", "kaos-edisi-2"],
    ["—", ""],
    ["", ""],
  ])("makes %j into %j", (name, slug) => {
    expect(toProductSlug(name)).toBe(slug);
  });

  it("keeps a slug of exactly 200 characters", () => {
    const name = "a".repeat(200);

    expect(toProductSlug(name)).toBe(name);
  });

  it("cuts a long name at a word boundary that falls on the limit", () => {
    // Two whole words fill exactly 200 characters; the third is dropped,
    // and the second is kept whole.
    const kept = `${"a".repeat(97)}-${"b".repeat(102)}`;

    expect(kept).toHaveLength(200);
    expect(toProductSlug(`${"a".repeat(97)} ${"b".repeat(102)} ccc`)).toBe(
      kept,
    );
  });

  it("drops a word cut in the middle", () => {
    expect(toProductSlug(`${"a".repeat(195)} bbbbbbbbbb`)).toBe(
      "a".repeat(195),
    );
  });

  it("keeps one long word cut at 200", () => {
    expect(toProductSlug("a".repeat(250))).toBe("a".repeat(200));
  });

  it("always gives a valid slug or nothing", () => {
    for (const name of [
      "Kaos X",
      "a--b",
      "Ölçü 42",
      "🔑 Kunci",
      "ab ".repeat(100),
    ]) {
      const slug = toProductSlug(name);
      expect(slug === "" || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)).toBe(true);
      expect(slug.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("stockLevel", () => {
  it.each([
    [0, "out"],
    [-1, "out"],
    [1, "low"],
    [LOW_STOCK_THRESHOLD, "low"],
    [LOW_STOCK_THRESHOLD + 1, "ok"],
  ])("calls %d %s", (stock, level) => {
    expect(stockLevel(stock)).toBe(level);
  });
});
