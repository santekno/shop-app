import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import {
  categoriesQuery,
  productListQuery,
} from "@/features/catalog/api/queries.ts";
import {
  CATALOG_PAGE_SIZE,
  readCatalogFilters,
} from "@/features/catalog/catalog-filters.ts";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { getQueryClient } from "@/lib/query-client.ts";
import { REVALIDATE_SECONDS, serverApi } from "@/lib/server-api.ts";

// `absolute`: the root layout's title template applies to the pages below
// it, not to the page in its own folder, so this one is written out.
export const metadata: Metadata = { title: { absolute: "Katalog — GoShop" } };

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
 * A failure is swallowed (`.catch(ignore)`): when the API fails (or
 * answers UNKNOWN_CATEGORY), nothing is dehydrated, and the browser asks
 * again and shows the error with its retry, as before.
 */
export default async function Home({ searchParams }: HomeProps) {
  const filters = readCatalogFilters(toSearchParams(await searchParams));
  const queryClient = getQueryClient();

  await Promise.all([
    queryClient
      .infiniteQuery(
        productListQuery(
          { ...filters, limit: CATALOG_PAGE_SIZE },
          serverApi({
            revalidate: REVALIDATE_SECONDS.productList,
            tags: ["products"],
          }),
        ),
      )
      .catch(ignore),
    queryClient
      .query(
        categoriesQuery(
          serverApi({
            revalidate: REVALIDATE_SECONDS.categories,
            tags: ["categories"],
          }),
        ),
      )
      .catch(ignore),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CatalogPage />
    </HydrationBoundary>
  );
}
