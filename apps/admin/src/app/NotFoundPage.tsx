import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/**
 * The `*` route: a dashboard URL no route matches. Caddy answers
 * index.html for every path, so the router decides what exists, and a
 * single-page app says "not found" on the page instead of with a 404
 * status. Inside the dashboard layout, so the sidebar stays.
 */
export function NotFoundPage() {
  useDocumentTitle("Halaman tidak ditemukan — GoShop Admin");
  return (
    <>
      <PageHeader
        title="Halaman tidak ditemukan"
        description="Alamat ini tidak ada di dasbor. Mungkin tautannya salah ketik."
      />
      <p>
        <Link to="/">Kembali ke ringkasan</Link>
      </p>
    </>
  );
}
