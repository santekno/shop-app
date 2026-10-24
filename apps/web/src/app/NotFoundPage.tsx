import { Link } from "react-router";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/**
 * The 404 page: the `*` route, for any URL no other route matches. The
 * server cannot know which paths exist (Caddy answers index.html for all
 * of them), so the router decides, here.
 */
export function NotFoundPage() {
  useDocumentTitle("Halaman tidak ditemukan — GoShop");
  return (
    <div className="page">
      <h1 tabIndex={-1}>Halaman tidak ditemukan</h1>
      <p>Alamat ini tidak ada di GoShop. Mungkin tautannya salah ketik.</p>
      <p>
        <Link to="/">Kembali ke katalog</Link>
      </p>
    </div>
  );
}
