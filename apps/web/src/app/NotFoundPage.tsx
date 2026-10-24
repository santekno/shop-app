import { Link } from "react-router";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useLateHeadingFocus } from "@/hooks/useLateHeadingFocus.ts";

interface NotFoundPageProps {
  /** What is missing, in one sentence. Default: the page at this URL. */
  message?: string;
}

/**
 * The 404 content, for two cases that look the same to the buyer:
 *
 * - the `*` route: a URL no route matches. The server cannot know which
 *   paths exist (Caddy answers index.html for all of them), so the router
 *   decides, here;
 * - a route that matches but names nothing: /produk/:slug for a slug the
 *   API answers NOT_FOUND. RouteErrorPage shows this page for it.
 *
 * A single-page app cannot answer with HTTP status 404; the page says it
 * instead. (Bab 11's server-rendered storefront can send the real status.)
 */
export function NotFoundPage({
  message = "Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.",
}: NotFoundPageProps) {
  useDocumentTitle("Halaman tidak ditemukan — GoShop");
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
        <Link to="/">Kembali ke katalog</Link>
      </p>
    </div>
  );
}
