import "server-only";
import { cache } from "react";
import { listCategories } from "@goshop/shared";
import type { Category } from "@goshop/shared";
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
