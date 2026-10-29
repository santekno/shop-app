import "server-only";
import { cache } from "react";
import { listCategories, listProducts } from "@goshop/shared";
import type { Category, Product } from "@goshop/shared";
import { REVALIDATE_SECONDS, serverApi } from "@/lib/server-api.ts";

/**
 * Every category, fetched by the storefront's server through the data
 * cache (five minutes), or null when the API could not answer. Once per
 * request (React's cache()): the catalog's metadata needs them to name
 * the category and to tell an unknown one, and the page hands them to
 * the browser's cache.
 */
export const getCategoriesForPage = cache(
  async (): Promise<Category[] | null> => {
    try {
      return await listCategories(
        serverApi({
          revalidate: REVALIDATE_SECONDS.categories,
          tags: ["categories"],
        }),
      );
    } catch {
      return null;
    }
  },
);

/** The API's largest page of products (GET /v1/products, `limit`). */
const SITEMAP_PAGE_SIZE = 100;

/**
 * How many products one sitemap may list: the sitemap protocol allows
 * 50 000 URLs (and 50 MB) per file, and the catalog root and the
 * categories take a few. Past this, the sitemap needs splitting
 * (docs/web/README.md, artikel 11).
 */
export const SITEMAP_PRODUCT_LIMIT = 49_000;

/** How long a walk through the catalog for the sitemap is cached. */
export const SITEMAP_REVALIDATE_SECONDS = 3_600;

/**
 * Every active product, page by page through GET /v1/products (100 at a
 * time, following `next_cursor` until it is null), for the sitemap (Bab 11
 * artikel 11). Each page goes through the data cache for an hour, under
 * its own URL: anyone can ask for /sitemap.xml, and a walk through the
 * whole catalog costs one API request per hundred products, so it is paid
 * at most once an hour however often the sitemap is fetched.
 *
 * Stops at SITEMAP_PRODUCT_LIMIT, and if the API ever answered a cursor
 * it had answered before: a loop (A, B, A) would otherwise walk to the
 * limit, listing the same products again and again.
 */
export const listProductsForSitemap = async (): Promise<Product[]> => {
  const client = serverApi({
    revalidate: SITEMAP_REVALIDATE_SECONDS,
    tags: ["products", "sitemap"],
  });
  const products: Product[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await listProducts(client, {
      limit: SITEMAP_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    products.push(...page.data);
    const next = page.page.next_cursor;
    if (next === null || seen.has(next)) break;
    seen.add(next);
    if (products.length >= SITEMAP_PRODUCT_LIMIT) {
      console.warn(
        `sitemap: the catalog has more than ${String(SITEMAP_PRODUCT_LIMIT)} products; split the sitemap (generateSitemaps)`,
      );
      break;
    }
    cursor = next;
  }
  return products.slice(0, SITEMAP_PRODUCT_LIMIT);
};
