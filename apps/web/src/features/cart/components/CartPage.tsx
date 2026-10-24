import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { productPath } from "@/features/product/paths.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useCart } from "../hooks/useCart.ts";

/** Why checkout would refuse a line, in the buyer's words. */
const PROBLEM_TEXT = {
  unavailable: "Sudah tidak dijual",
  insufficient_stock: "Stok tidak cukup",
  price_changed: "Harga berubah",
} as const;

/**
 * /keranjang: a minimal cart page, the guest cart's lines and subtotal.
 * Changing quantities, removing lines and checking out are Bab 11's full
 * cart page.
 */
export function CartPage() {
  useDocumentTitle("Keranjang — GoShop");
  const { data: cart, status, error, isFetching, refetch } = useCart();

  return (
    <Card>
      <h1 tabIndex={-1}>Keranjang</h1>
      {(status === "pending" || (status === "error" && isFetching)) && (
        <LoadingState>Memuat keranjang…</LoadingState>
      )}
      {status === "error" && !isFetching && (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      )}
      {status === "success" &&
        (cart.lines.length === 0 ? (
          <>
            <EmptyState>Keranjang Anda masih kosong.</EmptyState>
            <p>
              <Link to="/">Lihat katalog</Link>
            </p>
          </>
        ) : (
          <>
            <ul className="mb-4 grid gap-3">
              {cart.lines.map((line) => (
                // Name above the total on a phone, side by side from sm.
                <li
                  key={line.variant_id}
                  className="cart-line flex flex-col gap-1 border-b border-[var(--border)] pb-3 sm:flex-row sm:justify-between sm:gap-4"
                >
                  <div>
                    <Link to={productPath(line.product_slug)}>
                      {line.product_name}
                    </Link>
                    <p className="muted">
                      {line.variant_name} · {line.quantity} ×{" "}
                      {formatRupiah(line.unit_price)}
                    </p>
                    {line.problem !== null && (
                      <p className="badge">{PROBLEM_TEXT[line.problem]}</p>
                    )}
                  </div>
                  <strong>{formatRupiah(line.line_total)}</strong>
                </li>
              ))}
            </ul>
            <p className="cart-subtotal text-right">
              Subtotal ({cart.item_count} barang):{" "}
              <strong>{formatRupiah(cart.subtotal)}</strong>
            </p>
          </>
        ))}
    </Card>
  );
}
