import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import {
  categoriesQuery,
  productListQuery,
} from "@/features/catalog/api/queries.ts";
import { getCategoriesForPage } from "@/features/catalog/api/server.ts";
import {
  CATALOG_PAGE_SIZE,
  readCatalogFilters,
} from "@/features/catalog/catalog-filters.ts";
import { catalogPageMeta } from "@/features/catalog/catalog-metadata.ts";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { getQueryClient } from "@/lib/query-client.ts";
import { REVALIDATE_SECONDS, serverApi } from "@/lib/server-api.ts";
import { baseOpenGraph, SITE_NAME } from "@/lib/site-metadata.ts";

interface HomeProps {
  /** The query string, as Next.js parsed it: ?kategori=kaos&urut=termurah. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** A failed prefetch leaves the work to the browser. */
const ignore = () => undefined;

/** Next.js' parsed query string back into URLSearchParams. */
const toSearchParams = (
  query: Record<string, string | string[] | undefined>,
): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  return params;
};

/**
 * The catalog's <head> for the filters in the URL (artikel 10): title,
 * description, canonical URL, robots and Open Graph, decided by
 * catalogPageMeta (which URLs are indexed, and why). The categories come
 * from the same once-per-request fetch the page uses.
 */
export async function generateMetadata({
  searchParams,
}: HomeProps): Promise<Metadata> {
  const filters = readCatalogFilters(toSearchParams(await searchParams));
  const meta = catalogPageMeta(filters, await getCategoriesForPage());
  // `absolute`: the root layout's title template applies to the pages
  // below it, not to the page in its own folder, so it is written out.
  const title = `${meta.title} — ${SITE_NAME}`;
  return {
    title: { absolute: title },
    description: meta.description,
    ...(meta.canonicalPath === undefined
      ? {}
      : { alternates: { canonical: meta.canonicalPath } }),
    ...(meta.index ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      ...baseOpenGraph,
      title,
      description: meta.description,
      ...(meta.canonicalPath === undefined ? {} : { url: meta.canonicalPath }),
    },
  };
}

/**
 * "/": the catalog, rendered on the server (Bab 11 artikel 09).
 *
 * The server reads the filters from the query string with the same
 * readCatalogFilters the browser uses, and fetches the first page of
 * products and the categories into a QueryClient of its own, through
 * Next.js' data cache. HydrationBoundary hands that cache to the browser:
 * CatalogPage (a client component) finds both under the keys it asks for,
 * renders them at once, and loads the next pages from the browser as
 * before ("Muat lebih banyak", infinite scroll). A crawler gets the first
 * twelve products as HTML, with a link to each.
 *
 * A failure is swallowed: when the API fails (or answers
 * UNKNOWN_CATEGORY), nothing is dehydrated, and the browser asks again
 * and shows the error with its retry, as before.
 */
export default async function Home({ searchParams }: HomeProps) {
  const filters = readCatalogFilters(toSearchParams(await searchParams));
  const queryClient = getQueryClient();

  // The categories: the fetch generateMetadata already made (cache()).
  const categories = await getCategoriesForPage();
  if (categories !== null) {
    queryClient.setQueryData(categoriesQuery().queryKey, categories);
  }
  await queryClient
    .infiniteQuery(
      productListQuery(
        { ...filters, limit: CATALOG_PAGE_SIZE },
        serverApi({
          revalidate: REVALIDATE_SECONDS.productList,
          tags: ["products"],
        }),
      ),
    )
    .catch(ignore);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CatalogPage />
    </HydrationBoundary>
  );
}
