import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/**
 * /keranjang: a minimal cart page. Adding to the cart arrives in
 * artikel 06; the full cart page (quantities, removing lines, checkout)
 * is Bab 11.
 */
export function CartPage() {
  useDocumentTitle("Keranjang — GoShop");
  return (
    <Card>
      <h1 tabIndex={-1}>Keranjang</h1>
      <p className="muted">Keranjang Anda masih kosong.</p>
      <p>
        <Link to="/">Lihat katalog</Link>
      </p>
    </Card>
  );
}
