import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productQuery } from "@/features/product/api/queries.ts";
import { getProductForPage } from "@/features/product/api/server.ts";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { getQueryClient } from "@/lib/query-client.ts";

interface ProductPageProps {
  /** The URL's parameters: a promise, resolved when the page needs it. */
  params: Promise<{ slug: string }>;
}

/** The first sentence or so of a description, for <meta name="description">. */
const DESCRIPTION_LENGTH = 160;
const summary = (text: string): string =>
  text.length <= DESCRIPTION_LENGTH
    ? text
    : `${text.slice(0, DESCRIPTION_LENGTH - 1).trimEnd()}…`;

/**
 * The page's <title> and description, from the same product the page
 * renders (getProductForPage runs once per request). Artikel 10 adds Open
 * Graph and structured data.
 */
export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const product = await getProductForPage((await params).slug);
  if (product === null) return { title: "Produk tidak ditemukan" };
  return { title: product.name, description: summary(product.description) };
}

/**
 * /produk/[slug]: one product, rendered on the server (Bab 11 artikel 09).
 *
 * An async server component: it awaits the product from the API (through
 * Next.js' data cache), so the HTML the server sends already holds the
 * name, the price, the description and the variants. A product the API
 * does not know is notFound(): HTTP 404 with ./not-found.tsx.
 *
 * ProductDetailPage stays a client component (variants, quantity, "Tambah
 * ke keranjang") that reads the product with useQuery. To keep it from
 * fetching the product a second time from the browser, the server puts
 * the product in a QueryClient of its own (one per request), and
 * HydrationBoundary hands that cache to the browser inside the page's
 * payload: useQuery finds the product under the same key and starts with
 * it, fresh for the storefront's stale time.
 */
export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductForPage(slug);
  if (product === null) notFound();

  const queryClient = getQueryClient();
  queryClient.setQueryData(productQuery(slug).queryKey, product);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductDetailPage slug={slug} />
    </HydrationBoundary>
  );
}
