import type { Metadata } from "next";
import { NotFoundPage } from "@/components/layout/NotFoundPage.tsx";

export const metadata: Metadata = { title: "Produk tidak ditemukan" };

/** notFound() on a product page: a product that does not exist (404). */
export default function ProductNotFound() {
  return (
    <NotFoundPage message="Produk ini tidak ada atau sudah tidak dijual." />
  );
}
