import { describe, expect, it } from "@jest/globals";
import type { ProductImage } from "@goshop/shared";

import { product } from "@/test/fixtures";
import {
  MAX_RECENT,
  addRecent,
  readRecentItems,
  toRecentItem,
  type RecentItem,
} from "./recent-state";

const item = (
  slug: string,
  overrides: Partial<RecentItem> = {},
): RecentItem => ({
  slug,
  name: slug.toUpperCase(),
  image: null,
  priceFrom: 10_000,
  hasPriceRange: false,
  ...overrides,
});

const photo: ProductImage = {
  id: "img-1",
  url: "https://cdn.goshop.test/p/a-800.jpg",
  alt: "",
  width: 800,
  height: 800,
  variants: [
    { url: "https://cdn.goshop.test/p/a-400.jpg", width: 400, height: 400 },
    { url: "https://cdn.goshop.test/p/a-800.jpg", width: 800, height: 800 },
  ],
};

describe("toRecentItem", () => {
  it("keeps the slug, name, cheapest price and the narrowest photo, nothing else", () => {
    const kaos = product("Kaos Polos", { images: [photo] });

    expect(toRecentItem(kaos)).toEqual({
      slug: "kaos-polos",
      name: "Kaos Polos",
      image: {
        id: "img-1",
        url: "https://cdn.goshop.test/p/a-400.jpg",
        width: 400,
        height: 400,
      },
      priceFrom: 89_000,
      hasPriceRange: false,
    });
  });

  it("uses the photo itself when it has no sizes", () => {
    const kaos = product("Kaos", { images: [{ ...photo, variants: [] }] });

    expect(toRecentItem(kaos).image).toEqual({
      id: "img-1",
      url: photo.url,
      width: 800,
      height: 800,
    });
  });

  it("has no image for a product without photos", () => {
    expect(toRecentItem(product("Kaos")).image).toBeNull();
  });

  it("flags a price range when a variant costs more than price_from", () => {
    const base = product("Hoodie", {
      price_from: { amount: 150_000, currency: "IDR" },
    });
    const [variant] = base.variants;
    if (variant === undefined) throw new Error("fixture has a variant");
    const ranged = {
      ...base,
      variants: [
        { ...variant, price: { amount: 150_000, currency: "IDR" as const } },
        {
          ...variant,
          id: "v2",
          price: { amount: 175_000, currency: "IDR" as const },
        },
      ],
    };

    expect(toRecentItem(ranged).hasPriceRange).toBe(true);
    expect(toRecentItem(base).hasPriceRange).toBe(false);
  });
});

describe("addRecent", () => {
  it("puts the newest first", () => {
    expect(addRecent([item("a")], item("b")).map((i) => i.slug)).toEqual([
      "b",
      "a",
    ]);
  });

  it("moves a product seen again to the front, once", () => {
    const result = addRecent([item("a"), item("b"), item("c")], item("c"));

    expect(result.map((i) => i.slug)).toEqual(["c", "a", "b"]);
  });

  it("keeps the 10 newest", () => {
    const ten = Array.from({ length: MAX_RECENT }, (_, i) => item(`p${i}`));

    const result = addRecent(ten, item("new"));

    expect(MAX_RECENT).toBe(10);
    expect(result).toHaveLength(10);
    expect(result[0]?.slug).toBe("new");
    expect(result.at(-1)?.slug).toBe("p8");
  });

  it("returns the same array when the first entry is identical, so nothing is written", () => {
    const list = [item("a"), item("b")];

    expect(addRecent(list, item("a"))).toBe(list);
  });

  it.each([
    ["name", { name: "Baru" }],
    ["price", { priceFrom: 20_000 }],
    ["range", { hasPriceRange: true }],
    [
      "photo",
      { image: { id: "i", url: "https://x/y.jpg", width: 1, height: 1 } },
    ],
  ])("a changed %s at the front is stored", (_what, change) => {
    const list = [item("a")];

    const result = addRecent(list, item("a", change));

    expect(result).not.toBe(list);
    expect(result[0]).toMatchObject(change);
  });
});

describe("readRecentItems", () => {
  it("returns nothing for anything that is not a list", () => {
    for (const value of [undefined, null, "x", 5, {}]) {
      expect(readRecentItems(value)).toEqual([]);
    }
  });

  it("keeps well-formed entries as they are", () => {
    const good = item("a", {
      image: { id: "i", url: "https://x/y.jpg", width: 4, height: 3 },
      hasPriceRange: true,
    });

    expect(readRecentItems([good])).toEqual([good]);
  });

  it("drops entries of the wrong shape and keeps the rest", () => {
    const result = readRecentItems([
      null,
      "text",
      { slug: "", name: "kosong", priceFrom: 1 },
      { slug: "no-name", priceFrom: 1 },
      { slug: "no-price", name: "x" },
      { slug: "str-price", name: "x", priceFrom: "1" },
      { slug: "ok", name: "Ok", priceFrom: 5 },
    ]);

    expect(result.map((i) => i.slug)).toEqual(["ok"]);
  });

  it("turns a malformed photo into no photo, and a missing range flag into false", () => {
    const [result] = readRecentItems([
      {
        slug: "a",
        name: "A",
        priceFrom: 1,
        image: { id: "i", url: 3 },
        hasPriceRange: "yes",
      },
    ]);

    expect(result).toEqual({
      slug: "a",
      name: "A",
      priceFrom: 1,
      image: null,
      hasPriceRange: false,
    });
  });

  it("keeps the first of a duplicated slug and at most 10 entries", () => {
    const many = Array.from({ length: 15 }, (_, i) => item(`p${i}`));

    expect(
      readRecentItems([
        item("a", { name: "pertama" }),
        item("a", { name: "kedua" }),
      ]),
    ).toHaveLength(1);
    expect(
      readRecentItems([
        item("a", { name: "pertama" }),
        item("a", { name: "kedua" }),
      ])[0]?.name,
    ).toBe("pertama");
    expect(readRecentItems(many)).toHaveLength(10);
  });
});
