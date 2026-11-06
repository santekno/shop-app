// The pure part of "Terakhir dilihat" (artikel 15): what is kept for a
// product, how a new one is added, and how stored data is checked. No
// React, no storage, so it can be tested on its own.
import type { Product } from "@goshop/shared";

/** How many products the list keeps. */
export const MAX_RECENT = 10;

/** The one photo kept, the narrowest size: a 144 dp card needs no more. */
export interface RecentImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

/**
 * What is stored about a viewed product, and nothing else: no account, no
 * token, no device id. The price is a snapshot ("from" this much when it
 * was seen); the card only decorates a link, the product page shows the
 * truth.
 */
export interface RecentItem {
  slug: string;
  name: string;
  image: RecentImage | null;
  /** price_from.amount, whole rupiah. */
  priceFrom: number;
  /** True when the product has variants at different prices ("Mulai"). */
  hasPriceRange: boolean;
}

/** The snapshot of a product as the detail screen has just loaded it. */
export function toRecentItem(product: Product): RecentItem {
  // Variants come narrowest first (openapi.yaml); a photo without any
  // is described by itself.
  const photo = product.images[0];
  const smallest = photo?.variants[0] ?? photo;
  return {
    slug: product.slug,
    name: product.name,
    image:
      photo === undefined || smallest === undefined
        ? null
        : {
            id: photo.id,
            url: smallest.url,
            width: smallest.width,
            height: smallest.height,
          },
    priceFrom: product.price_from.amount,
    hasPriceRange: product.variants.some(
      (variant) => variant.price.amount !== product.price_from.amount,
    ),
  };
}

const sameItem = (a: RecentItem, b: RecentItem): boolean =>
  a.slug === b.slug &&
  a.name === b.name &&
  a.priceFrom === b.priceFrom &&
  a.hasPriceRange === b.hasPriceRange &&
  a.image?.url === b.image?.url;

/**
 * `item` first, any earlier entry for the same slug dropped, at most
 * MAX_RECENT kept. Returns the same array when nothing would change (the
 * product is already first and identical), so the store keeps the same
 * list and tells no subscriber for a refetch of the page being viewed.
 * (zustand's persist middleware still rewrites the same JSON to storage.)
 */
export function addRecent(
  items: readonly RecentItem[],
  item: RecentItem,
): readonly RecentItem[] {
  const [first] = items;
  if (first !== undefined && sameItem(first, item)) return items;
  return [item, ...items.filter((other) => other.slug !== item.slug)].slice(
    0,
    MAX_RECENT,
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function readImage(value: unknown): RecentImage | null {
  if (!isRecord(value)) return null;
  const { id, url, width, height } = value;
  return typeof id === "string" &&
    typeof url === "string" &&
    typeof width === "number" &&
    typeof height === "number"
    ? { id, url, width, height }
    : null;
}

/**
 * Stored data is input from outside, like a deep link: an old version, a
 * hand-edited value or a truncated write must not crash the home screen.
 * Keeps the entries that have the right shape, drops the rest, applies
 * the cap and the dedupe again.
 */
export function readRecentItems(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: RecentItem[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) continue;
    const { slug, name, image, priceFrom, hasPriceRange } = entry;
    if (
      typeof slug !== "string" ||
      slug === "" ||
      typeof name !== "string" ||
      typeof priceFrom !== "number" ||
      seen.has(slug)
    )
      continue;
    seen.add(slug);
    items.push({
      slug,
      name,
      image: readImage(image),
      priceFrom,
      hasPriceRange: hasPriceRange === true,
    });
    if (items.length === MAX_RECENT) break;
  }
  return items;
}
