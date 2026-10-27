import "server-only";
import { cache } from "react";
import { getProduct, isApiError } from "@goshop/shared";
import type { Product } from "@goshop/shared";
import { REVALIDATE_SECONDS, serverApi } from "@/lib/server-api.ts";

/**
 * One product for its page, fetched by the storefront's server (Bab 11
 * artikel 09), or null when the API says NOT_FOUND (a slug that names no
 * active product, or does not even look like one: the API answers both
 * the same way).
 *
 * - Next.js' data cache keeps the answer REVALIDATE_SECONDS.product
 *   seconds for every visitor; the tags let an admin change drop it early
 *   (revalidateTag("product:<slug>"), when Bab 12 has an admin).
 * - React's cache() runs it once per request: generateMetadata (the
 *   title) and the page both ask for the product, and get the same
 *   promise. Next.js' own memoisation of equal fetches does not apply,
 *   because the API client passes an AbortSignal (for its timeout).
 * - Any other error is thrown: the page answers 500 with app/error.tsx,
 *   so a search engine retries later instead of indexing an error page.
 */
export const getProductForPage = cache(
  async (slug: string): Promise<Product | null> => {
    const client = serverApi({
      revalidate: REVALIDATE_SECONDS.product,
      tags: ["products", `product:${slug}`],
    });
    try {
      return await getProduct(client, slug);
    } catch (error) {
      if (isApiError(error, "NOT_FOUND")) return null;
      throw error;
    }
  },
);
