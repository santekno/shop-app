import type { Product, ProductVariant } from "@goshop/shared";
import { catalogSearch } from "@/features/catalog/catalog-filters.ts";
import { SITE_NAME } from "@/lib/site-metadata.ts";
import { productPath } from "./paths.ts";

/**
 * schema.org structured data for a product page (Bab 11 artikel 10), as
 * plain objects; components/JsonLd.tsx writes them into the page.
 *
 * Only what the page itself shows, and only what is true: search engines
 * compare structured data with the visible page and ignore (or penalise)
 * markup that claims more.
 *
 * - **Product** with the name, description, category, photos and the
 *   page's URL. No `brand`: the catalog has no brand field, and the shop's
 *   own name is not the maker's. No `aggregateRating` or `review`: GoShop
 *   has no reviews.
 * - **The price** is an `Offer` when there is one variant (with its SKU),
 *   and an `AggregateOffer` when there are several: the lowest and highest
 *   price, how many, in stock if any variant is, and each variant as an
 *   `Offer` with its own SKU, name, price and stock. Not a `ProductGroup`
 *   with `hasVariant`: Google requires `variesBy` (size, colour, …), and a
 *   GoShop variant is a free name ("M", "500 g", "Hitam") with no typed
 *   attribute to name truthfully.
 * - **Money** is whole rupiah (`Money.amount`), written as a number with
 *   `priceCurrency: "IDR"`; never the formatted "Rp 45.000".
 * - **Availability** from the stock the API reports, as schema.org URLs.
 */

const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

const availability = (inStock: boolean) => (inStock ? IN_STOCK : OUT_OF_STOCK);

const variantOffer = (variant: ProductVariant, url: string) => ({
  "@type": "Offer",
  sku: variant.sku,
  name: variant.name,
  price: variant.price.amount,
  priceCurrency: variant.price.currency,
  availability: availability(variant.stock > 0),
  url,
  itemCondition: "https://schema.org/NewCondition",
  seller: { "@type": "Organization", name: SITE_NAME },
});

/** The Product object of `product`, whose page is at `origin` + its path. */
export const productJsonLd = (product: Product, origin: URL) => {
  const url = new URL(productPath(product.slug), origin).href;
  const [only, ...others] = product.variants;
  const prices = product.variants.map((variant) => variant.price.amount);

  const offers =
    only !== undefined && others.length === 0
      ? variantOffer(only, url)
      : {
          "@type": "AggregateOffer",
          priceCurrency: product.price_from.currency,
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: product.variants.length,
          availability: availability(product.in_stock),
          offers: product.variants.map((variant) => variantOffer(variant, url)),
        };

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.description,
    url,
    category: product.category.name,
    // A single-variant product has one SKU; several variants each carry
    // theirs on their Offer.
    ...(only !== undefined && others.length === 0 ? { sku: only.sku } : {}),
    ...(product.images.length > 0
      ? { image: product.images.map((image) => image.url) }
      : {}),
    offers,
  };
};

/** Katalog › the product's category › the product, as on the page. */
export const productBreadcrumbJsonLd = (product: Product, origin: URL) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Katalog",
      item: new URL("/", origin).href,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: product.category.name,
      item: new URL(
        `/${catalogSearch({
          category: product.category.slug,
          q: undefined,
          sort: "newest",
        })}`,
        origin,
      ).href,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: product.name,
      item: new URL(productPath(product.slug), origin).href,
    },
  ],
});
