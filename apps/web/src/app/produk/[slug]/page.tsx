import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd.tsx";
import { productQuery } from "@/features/product/api/queries.ts";
import { getProductForPage } from "@/features/product/api/server.ts";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { productPath } from "@/features/product/paths.ts";
import {
  productBreadcrumbJsonLd,
  productJsonLd,
} from "@/features/product/structured-data.ts";
import { getQueryClient } from "@/lib/query-client.ts";
import { siteUrl } from "@/lib/server-config.ts";
import { baseOpenGraph, SITE_NAME, summary } from "@/lib/site-metadata.ts";

interface ProductPageProps {
  /** The URL's parameters: a promise, resolved when the page needs it. */
  params: Promise<{ slug: string }>;
}

/**
 * The product page's <head> (artikel 10), from the same product the page
 * renders (getProductForPage runs once per request):
 *
 * - the title and a description cut at a word, at most 160 characters;
 * - the canonical URL, /produk/<slug>, made absolute by the root layout's
 *   metadataBase (SITE_URL), so a copy reached by another URL (a
 *   tracking parameter, an old host) points search engines here;
 * - Open Graph and Twitter tags, which link previews (WhatsApp, Telegram,
 *   Slack, X) read without running JavaScript: the first photo when there
 *   is one, a large card then, a small one otherwise.
 *
 * A missing product's 404 page gets the title only; Next.js adds
 * `noindex` to a notFound() page itself.
 */
export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const product = await getProductForPage((await params).slug);
  if (product === null) return { title: "Produk tidak ditemukan" };

  const title = `${product.name} — ${SITE_NAME}`;
  const description = summary(product.description);
  const path = productPath(product.slug);
  const image = product.images[0];
  const images =
    image === undefined
      ? undefined
      : [
          {
            url: image.url,
            width: image.width,
            height: image.height,
            alt: image.alt === "" ? product.name : image.alt,
          },
        ];

  return {
    title: product.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...baseOpenGraph,
      title,
      description,
      url: path,
      ...(images === undefined ? {} : { images }),
    },
    twitter: {
      card: images === undefined ? "summary" : "summary_large_image",
      title,
      description,
      ...(images === undefined ? {} : { images }),
    },
  };
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
 *
 * The structured data (artikel 10, features/product/structured-data.ts)
 * is rendered here, by the server only: a Product with its offers and a
 * BreadcrumbList, as JSON-LD.
 */
export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getProductForPage(slug);
  if (product === null) notFound();

  const queryClient = getQueryClient();
  queryClient.setQueryData(productQuery(slug).queryKey, product);
  const origin = siteUrl();

  return (
    <>
      <JsonLd data={productJsonLd(product, origin)} />
      <JsonLd data={productBreadcrumbJsonLd(product, origin)} />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ProductDetailPage slug={slug} />
      </HydrationBoundary>
    </>
  );
}
