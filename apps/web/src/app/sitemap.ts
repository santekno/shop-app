import type { MetadataRoute } from "next";
import {
  getCategoriesForPage,
  listProductsForSitemap,
} from "@/features/catalog/api/server.ts";
import { catalogPageMeta } from "@/features/catalog/catalog-metadata.ts";
import { productPath } from "@/features/product/paths.ts";
import { siteUrl } from "@/lib/server-config.ts";

// Built for each request, never at `next build`: the API is not there
// during an image build, and SITE_URL is read when the server runs. The
// API's answers are still cached (an hour for the product walk, five
// minutes for the categories), so a request costs a render, not a walk.
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml (Bab 11 artikel 11): every URL search engines should index,
 * and nothing else, so a crawler finds each product without following
 * links and never wastes a visit on a page that says `noindex`.
 *
 * - The catalog root and each category's list, with the canonical paths
 *   catalogPageMeta (artikel 10) gives them: the same rule decides what is
 *   indexed and what is listed here, so the two cannot disagree. No sort
 *   orders and no searches: those are not canonical.
 * - Every active product, from the API page by page
 *   (listProductsForSitemap).
 * - No `lastModified`: the API's public Product has `created_at` but no
 *   `updated_at`, and a creation date would claim that a product whose
 *   price changed yesterday last changed a year ago; Google ignores a
 *   lastmod it finds unreliable for the whole site. Added when the API
 *   exposes `updated_at` (requested). No `changeFrequency` or `priority`:
 *   Google ignores both.
 *
 * If the API does not answer, the error is thrown and the sitemap answers
 * 500: a crawler tries again later, where an empty sitemap would tell it
 * the shop has no pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const [products, categories] = await Promise.all([
    listProductsForSitemap(),
    getCategoriesForPage(),
  ]);
  if (categories === null) {
    throw new Error("sitemap: the API did not answer GET /v1/categories");
  }

  const catalogPaths = [
    "/",
    ...categories.map(
      (category) =>
        catalogPageMeta(
          { category: category.slug, q: undefined, sort: "newest" },
          categories,
        ).canonicalPath,
    ),
  ].filter((path): path is string => path !== undefined);

  return [
    ...catalogPaths.map((path) => ({ url: new URL(path, origin).href })),
    ...products.map((product) => ({
      url: new URL(productPath(product.slug), origin).href,
    })),
  ];
}
