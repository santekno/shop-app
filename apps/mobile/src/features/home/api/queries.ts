// The home screen's TanStack Query options: the banners and the featured
// products. The categories row reuses the catalog's categoriesQuery, so
// Beranda, the Kategori tab and the category chip share one cache entry.
import { listProducts } from "@goshop/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { fetchBanners } from "./banners";

/** How many featured products the home screen shows. */
export const FEATURED_LIMIT = 8;

/** Banners change when the shop edits them, not by the minute. */
const BANNERS_STALE_TIME_MS = 5 * 60_000;

/** GET /v1/banners as query options (key and function kept together). */
export const bannersQuery = () =>
  queryOptions({
    queryKey: queryKeys.banners,
    queryFn: ({ signal }) => fetchBanners(signal),
    staleTime: BANNERS_STALE_TIME_MS,
  });

/**
 * GET /v1/products?featured=true: the products the shop features, newest
 * first, one page only (the "Unggulan" row is a taste of the catalog, not a
 * second list; the full catalog is below it).
 */
export const featuredProductsQuery = () =>
  queryOptions({
    queryKey: queryKeys.products.featured(),
    queryFn: async ({ signal }) =>
      (
        await listProducts(
          api,
          { featured: "true", limit: FEATURED_LIMIT, sort: "newest" },
          { signal },
        )
      ).data,
  });
