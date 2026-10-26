import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { productPath } from "@/features/product/paths.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { Button } from "@/components/ui/Button.tsx";
import { selectCartExpired, useCartStore } from "../cart-store.ts";
import { useCart } from "../hooks/useCart.ts";
import { EmptyCart } from "./EmptyCart.tsx";
import { Badge } from "@/components/ui/Badge.tsx";

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
  // Client state from the cart store: the API forgot our cart, and the
  // buyer has not read why yet.
  const cartExpired = useCartStore(selectCartExpired);
  const dismissCartExpired = useCartStore((state) => state.dismissCartExpired);

  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Keranjang
      </h1>
      <div
        className={
          cartExpired
            ? "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-4 py-3"
            : undefined
        }
      >
        {/* Always rendered, so screen readers hear the text when it
            appears (a live region must exist before it changes). */}
        <p role="status">
          {cartExpired &&
            "Keranjang Anda sebelumnya sudah tidak berlaku, jadi sekarang kosong."}
        </p>
        {cartExpired && (
          <Button variant="outline" size="sm" onClick={dismissCartExpired}>
            Tutup
          </Button>
        )}
      </div>
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
          <EmptyCart />
        ) : (
          <>
            <ul className="mb-4 grid gap-3">
              {cart.lines.map((line) => (
                // Name above the total on a phone, side by side from sm.
                <li
                  key={line.variant_id}
                  className="cart-line flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:justify-between sm:gap-4"
                >
                  <div>
                    <Link to={productPath(line.product_slug)}>
                      {line.product_name}
                    </Link>
                    <p className="mt-0.5 text-muted-foreground">
                      {line.variant_name} · {line.quantity} ×{" "}
                      {formatRupiah(line.unit_price)}
                    </p>
                    {line.problem !== null && (
                      <Badge variant="destructive" className="badge mt-1">
                        {PROBLEM_TEXT[line.problem]}
                      </Badge>
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
