// A few products in the exact shape GET /v1/products returns (the API's
// `Product`), so the home screen has something to draw before it talks to
// the API. Artikel 06 replaces them with the real catalog and this file
// goes.
//
// The photos come from picsum.photos, a public placeholder-image service,
// because the API's own image storage (http://localhost:8333) is not
// reachable from a phone and not running without `make up`. Each photo has
// the two widths the worker writes for a real upload, 400 and 800 pixels
// (ADR 0007), so the card meets the same `variants` it will get from the API.
import type { Product, ProductImage } from "@goshop/shared";

const CREATED_AT = "2026-10-01T08:00:00Z";

/** A square photo with a 400 and an 800 pixel variant, like the worker's. */
const photo = (picsumId: number, alt: string): ProductImage => {
  const url = (width: number) =>
    `https://picsum.photos/id/${picsumId}/${width}/${width}`;
  return {
    id: `00000000-0000-7000-a000-${String(picsumId).padStart(12, "0")}`,
    url: url(800),
    alt,
    width: 800,
    height: 800,
    variants: [
      { width: 400, height: 400, url: url(400) },
      { width: 800, height: 800, url: url(800) },
    ],
  };
};

const category = (
  n: number,
  slug: string,
  name: string,
): Product["category"] => ({
  id: `00000000-0000-7000-9000-${String(n).padStart(12, "0")}`,
  slug,
  name,
  parent_id: null,
});

/** A product whose variants cost `prices` and hold `stocks` units. */
const product = (
  n: number,
  fields: Pick<Product, "slug" | "name" | "category" | "images">,
  prices: readonly number[],
  stocks: readonly number[],
): Product => {
  const variants = prices.map((amount, i) => ({
    id: `00000000-0000-7000-b000-${String(n * 10 + i).padStart(12, "0")}`,
    sku: `${fields.slug.slice(0, 3).toUpperCase()}-${String(i + 1)}`,
    name: i === 0 ? "Standar" : `Varian ${String(i + 1)}`,
    price: { amount, currency: "IDR" as const },
    stock: stocks[i] ?? 0,
  }));
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    description: "",
    ...fields,
    // The API computes both from the sellable variants; so do we.
    price_from: { amount: Math.min(...prices), currency: "IDR" },
    in_stock: variants.some((variant) => variant.stock > 0),
    variants,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
};

const sepatu = category(1, "sepatu", "Sepatu");
const aksesoris = category(2, "aksesoris", "Aksesoris");
const minuman = category(3, "minuman", "Minuman");
const kaos = category(4, "kaos", "Kaos");

/**
 * Six products that cover what a card must handle: with and without a
 * photo, one price or a range ("Mulai"), in stock or sold out, and a name
 * too long for two lines.
 */
export const SAMPLE_PRODUCTS: readonly Product[] = [
  product(
    1,
    {
      slug: "sepatu-kanvas-hitam",
      name: "Sepatu Kanvas Hitam",
      category: sepatu,
      images: [photo(21, "Sepasang sepatu di lantai kayu")],
    },
    [249000, 259000],
    [4, 2],
  ),
  product(
    2,
    {
      slug: "kacamata-hitam-klasik",
      name: "Kacamata Hitam Klasik dengan Lensa Terpolarisasi dan Bingkai Ringan",
      category: aksesoris,
      images: [photo(26, "Kacamata hitam di atas meja")],
    },
    [175000],
    [9],
  ),
  product(
    3,
    {
      slug: "teh-melati-celup",
      name: "Teh Melati Celup isi 25",
      category: minuman,
      images: [photo(225, "Teh dalam gelas")],
    },
    [18500],
    [0],
  ),
  product(
    4,
    {
      slug: "kopi-arabika-gayo",
      name: "Kopi Arabika Gayo 250 g",
      category: minuman,
      images: [photo(431, "Secangkir kopi")],
    },
    [89000, 165000],
    [12, 5],
  ),
  product(
    5,
    {
      slug: "kaos-polos-hitam",
      name: "Kaos Polos Hitam",
      category: kaos,
      images: [],
    },
    [89000, 99000],
    [12, 0],
  ),
  product(
    6,
    {
      slug: "tumbler-stainless-500-ml",
      name: "Tumbler Stainless 500 ml",
      category: aksesoris,
      images: [],
    },
    [120000],
    [0],
  ),
];
