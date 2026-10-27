import { useRef, useState } from "react";
import { formatRupiah } from "@goshop/shared";
import type { CartLine } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { Button } from "@/components/ui/Button.tsx";
import { selectCartExpired, useCartStore } from "../cart-store.ts";
import { useCart } from "../hooks/useCart.ts";
import { CartLineItem } from "./CartLineItem.tsx";
import { EmptyCart } from "./EmptyCart.tsx";

/**
 * /keranjang: the full cart page (Bab 11 artikel 01). The guest cart, or
 * the logged-in buyer's own cart (useCart picks which, Bab 10); each line
 * can change its quantity, accept a new price or be removed
 * (CartLineItem), and the subtotal is the API's.
 *
 * The subtotal is the cart's hint (the contract says so): it moves with
 * an optimistic change and is replaced by the API's answer. What an order
 * really charges (shipping, the voucher's discount, the total) is computed
 * by the API at checkout (artikel 03), never on this page.
 *
 * Removing a line takes away the button that had the focus. Without help
 * the focus would fall to <body> and a screen reader would say nothing,
 * so the page heading takes the focus and a status line says what was
 * removed.
 */
export function CartPage() {
  useDocumentTitle("Keranjang — GoShop");
  const { data: cart, status, error, isFetching, refetch } = useCart();
  // Client state from the cart store: the API forgot our cart, and the
  // buyer has not read why yet.
  const cartExpired = useCartStore(selectCartExpired);
  const dismissCartExpired = useCartStore((state) => state.dismissCartExpired);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [removed, setRemoved] = useState<string | null>(null);

  const onRemoved = (line: CartLine) => {
    setRemoved(
      `${line.product_name} (${line.variant_name}) dihapus dari keranjang.`,
    );
    headingRef.current?.focus();
  };

  return (
    <Card>
      <h1 ref={headingRef} tabIndex={-1} className="mb-4">
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
      {/* The removal message: its own live region, for the same reason. */}
      <p role="status" className="sr-only">
        {removed}
      </p>
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
            <ul className="mb-4 grid gap-3" aria-label="Barang di keranjang">
              {cart.lines.map((line) => (
                <CartLineItem
                  key={line.variant_id}
                  line={line}
                  onRemoved={onRemoved}
                />
              ))}
            </ul>
            <p className="cart-subtotal text-right">
              Subtotal ({cart.item_count} barang):{" "}
              <strong>{formatRupiah(cart.subtotal)}</strong>
            </p>
            <p className="text-right text-sm text-muted-foreground">
              Ongkos kirim dan voucher dihitung saat checkout.
            </p>
          </>
        ))}
    </Card>
  );
}
