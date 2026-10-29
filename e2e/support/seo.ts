// What a crawler reads from a page's server HTML, before any JavaScript:
// the <title>, the <meta> and <link> tags of the head, and the JSON-LD
// blocks (Bab 11 artikel 10–12). Read from the HTML as the server sends
// it, with the request fixture, not from the hydrated page.
import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import type { ProductRow } from "./catalog.ts";
import { SITE_URL } from "./stack.ts";

/** HTML text back to its characters (the entities React writes). */
const unescapeHtml = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The attributes of one start tag. */
const attributesOf = (tag: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
    attributes[match[1] ?? ""] = unescapeHtml(match[2] ?? "");
  }
  return attributes;
};

/** What the head of a page tells search engines and link previews. */
export interface PageHead {
  status: number;
  title: string | undefined;
  /** The canonical link's href, if any. */
  canonical: string | undefined;
  /** The robots meta's content, if any. */
  robots: string | undefined;
  /** <meta name="…"> and <meta property="…">, by name or property. */
  meta: Record<string, string>;
  html: string;
}

/** GET path from the storefront and reads its head. */
export const headOf = async (
  request: APIRequestContext,
  path: string,
): Promise<PageHead> => {
  const response = await request.get(path);
  const html = await response.text();
  const meta: Record<string, string> = {};
  let canonical: string | undefined;
  for (const tag of html.match(/<(meta|link)\b[^>]*>/g) ?? []) {
    const attributes = attributesOf(tag);
    const key = attributes.name ?? attributes.property;
    if (tag.startsWith("<meta") && key !== undefined) {
      meta[key] = attributes.content ?? "";
    }
    if (tag.startsWith("<link") && attributes.rel === "canonical") {
      canonical = attributes.href;
    }
  }
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  return {
    status: response.status(),
    title: title === undefined ? undefined : unescapeHtml(title),
    canonical,
    robots: meta.robots,
    meta,
    html,
  };
};

/** Every JSON-LD block of an HTML page, parsed. */
export const jsonLdOf = (html: string): Record<string, unknown>[] =>
  [
    ...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g),
  ].map((m) => JSON.parse(m[1] ?? "null") as Record<string, unknown>);

/** The one JSON-LD block of a type, failing when there is not exactly one. */
export const jsonLdBlock = (
  html: string,
  type: string,
): Record<string, unknown> => {
  const blocks = jsonLdOf(html).filter((block) => block["@type"] === type);
  expect(blocks, `JSON-LD blocks of @type ${type}`).toHaveLength(1);
  return blocks[0] ?? {};
};

/** An absolute URL on the storefront's public origin (SITE_URL). */
export const siteUrl = (path: string): string =>
  new URL(path, `${SITE_URL}/`).href;

/** The same URL written the canonical way ("http://h" and "http://h/" alike). */
export const normalUrl = (url: string): string => new URL(url).href;

const SCHEMA = "https://schema.org/";

/**
 * The structured data a product page must carry for the API's product,
 * written out from the rules in docs/web/README.md (artikel 10): Product,
 * one Offer for one variant or an AggregateOffer listing each variant,
 * availability from the stock, no brand and no rating, and the photos'
 * URLs as `image` only when there are photos.
 */
export const expectedProductJsonLd = (
  product: ProductRow,
): Record<string, unknown> => {
  const url = siteUrl(`/produk/${product.slug}`);
  const availability = (inStock: boolean) =>
    `${SCHEMA}${inStock ? "InStock" : "OutOfStock"}`;
  const offers = product.variants.map((variant) => ({
    "@type": "Offer",
    sku: variant.sku,
    name: variant.name,
    price: variant.price.amount,
    priceCurrency: "IDR",
    availability: availability(variant.stock > 0),
    url,
    itemCondition: `${SCHEMA}NewCondition`,
    seller: { "@type": "Organization", name: "GoShop" },
  }));
  const prices = product.variants.map((variant) => variant.price.amount);
  const single = product.variants.length === 1;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    description: product.description,
    url,
    category: product.category.name,
    ...(product.images.length > 0
      ? { image: product.images.map((image) => image.url) }
      : {}),
    ...(single ? { sku: product.variants[0]?.sku } : {}),
    offers: single
      ? offers[0]
      : {
          "@type": "AggregateOffer",
          priceCurrency: "IDR",
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: product.variants.length,
          availability: availability(product.variants.some((v) => v.stock > 0)),
          offers,
        },
  };
};
