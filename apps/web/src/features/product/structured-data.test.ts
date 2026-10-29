import type { ProductImage } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { category, product, variant } from "@/test/fake-api.ts";
import { productBreadcrumbJsonLd, productJsonLd } from "./structured-data.ts";

const ORIGIN = new URL("https://shop.example.com");
const URL_KAOS = "https://shop.example.com/produk/kaos-polos";

const photo = (id: string): ProductImage => ({
  id,
  url: `https://cdn.example.com/${id}/800.jpg`,
  alt: "",
  width: 800,
  height: 800,
  variants: [],
});

const SELLER = { "@type": "Organization", name: "GoShop" };

describe("productJsonLd", () => {
  it("describes a single-variant product with one Offer and its SKU", () => {
    const kaos = product("kaos-polos", {
      name: "Kaos Polos",
      description: "Katun 100%.",
      variants: [
        variant("m", {
          sku: "KP-M",
          name: "M",
          price: { amount: 89_000, currency: "IDR" },
          stock: 3,
        }),
      ],
      images: [photo("a"), photo("b")],
    });

    expect(productJsonLd(kaos, ORIGIN)).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${URL_KAOS}#product`,
      name: "Kaos Polos",
      description: "Katun 100%.",
      url: URL_KAOS,
      category: "Kaos",
      sku: "KP-M",
      image: [
        "https://cdn.example.com/a/800.jpg",
        "https://cdn.example.com/b/800.jpg",
      ],
      offers: {
        "@type": "Offer",
        sku: "KP-M",
        name: "M",
        price: 89_000,
        priceCurrency: "IDR",
        availability: "https://schema.org/InStock",
        url: URL_KAOS,
        itemCondition: "https://schema.org/NewCondition",
        seller: SELLER,
      },
    });
  });

  it("marks a single variant without stock OutOfStock", () => {
    const kaos = product("kaos-polos", {
      variants: [variant("m", { stock: 0 })],
    });

    expect(productJsonLd(kaos, ORIGIN).offers).toMatchObject({
      "@type": "Offer",
      availability: "https://schema.org/OutOfStock",
    });
  });

  it("gives several variants an AggregateOffer with the lowest and highest price", () => {
    const kaos = product("kaos-polos", {
      variants: [
        variant("m", {
          sku: "KP-M",
          price: { amount: 89_000, currency: "IDR" },
          stock: 0,
        }),
        variant("xl", {
          sku: "KP-XL",
          price: { amount: 99_000, currency: "IDR" },
          stock: 2,
        }),
        variant("s", {
          sku: "KP-S",
          price: { amount: 85_000, currency: "IDR" },
          stock: 0,
        }),
      ],
    });

    const data = productJsonLd(kaos, ORIGIN);

    expect(data).not.toHaveProperty("sku");
    expect(data.offers).toMatchObject({
      "@type": "AggregateOffer",
      priceCurrency: "IDR",
      lowPrice: 85_000,
      highPrice: 99_000,
      offerCount: 3,
      availability: "https://schema.org/InStock",
    });
    expect(
      (
        data.offers as { offers: { sku: string; availability: string }[] }
      ).offers.map((offer) => [offer.sku, offer.availability]),
    ).toEqual([
      ["KP-M", "https://schema.org/OutOfStock"],
      ["KP-XL", "https://schema.org/InStock"],
      ["KP-S", "https://schema.org/OutOfStock"],
    ]);
  });

  it("marks the AggregateOffer OutOfStock when no variant has stock", () => {
    const kaos = product("kaos-polos", {
      variants: [variant("m", { stock: 0 }), variant("l", { stock: 0 })],
    });

    expect(productJsonLd(kaos, ORIGIN).offers).toMatchObject({
      availability: "https://schema.org/OutOfStock",
    });
  });

  it("leaves image out for a product without photos, never an empty list", () => {
    expect(productJsonLd(product("kaos-polos"), ORIGIN)).not.toHaveProperty(
      "image",
    );
  });

  it("claims no brand, rating or review the page does not show", () => {
    const data = productJsonLd(product("kaos-polos"), ORIGIN);

    expect(data).not.toHaveProperty("brand");
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
  });
});

describe("productBreadcrumbJsonLd", () => {
  it("is Katalog › the category's catalog URL › the product", () => {
    const kaos = product("kaos-polos", {
      name: "Kaos Polos",
      category: { ...category("c1", "Kaos Pria"), slug: "kaos-pria" },
    });

    expect(productBreadcrumbJsonLd(kaos, ORIGIN)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Katalog",
          item: "https://shop.example.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Kaos Pria",
          item: "https://shop.example.com/?kategori=kaos-pria",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Kaos Polos",
          item: URL_KAOS,
        },
      ],
    });
  });
});
