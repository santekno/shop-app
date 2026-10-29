"use client";

import Link from "next/link";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";

interface NotFoundPageProps {
  /** What is missing, in one sentence. Default: the page at this URL. */
  message?: string;
}

/**
 * The 404 content (app/not-found.tsx), for two cases that look the same
 * to the buyer:
 *
 * - a URL no page matches;
 * - a page that matches but names nothing: /produk/[slug] for a slug the
 *   API answers NOT_FOUND (it calls notFound(), with its own message).
 *
 * Unlike the single-page app of Bab 7–10, the server now knows which
 * paths exist, so both answer with HTTP status 404 (Bab 11 artikel 08):
 * a search engine drops the page instead of indexing an error.
 */
export function NotFoundPage({
  message = "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
}: NotFoundPageProps) {
  // A missing product is known only after its request: the heading
  // appears after the navigation.
  const headingRef = useLateHeadingFocus();
  return (
    <div className="grid gap-4">
      <h1 ref={headingRef} tabIndex={-1}>
        Halaman tidak ditemukan
      </h1>
      <p>{message}</p>
      <p>
        <Link href="/">Kembali ke katalog</Link>
      </p>
    </div>
  );
}
