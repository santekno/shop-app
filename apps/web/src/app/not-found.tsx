import type { Metadata } from "next";
import { NotFoundPage } from "@/components/layout/NotFoundPage.tsx";

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

/**
 * A URL no page matches, or a page that called notFound(): answered with
 * HTTP status 404 inside the root layout, so the header stays.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
