import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";

interface ProductPageProps {
  /** The URL's parameters: a promise, resolved when the page needs it. */
  params: Promise<{ slug: string }>;
}

/** /produk/[slug]: one product. The folder name [slug] is the parameter. */
export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  return <ProductDetailPage slug={slug} />;
}
