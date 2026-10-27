import { Link, Navigate, useSearchParams } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { ORDERS_PATH, paymentPath } from "../paths.ts";
import { findPaymentReturn } from "../payment-state.ts";

/**
 * /pembayaran/selesai: where Midtrans sends the buyer back (the "Finish
 * Redirect URL" of the Snap settings), with `?order_id=GS-…-K3D9QX&
 * status_code=…&transaction_status=…`.
 *
 * It reads only `order_id`, and only to find the order the buyer left to
 * pay (remembered in this tab by usePayOrder), then goes on to that
 * order's payment page, which asks the API. `transaction_status` is
 * ignored on purpose: it is part of a URL, and a URL proves nothing.
 *
 * A buyer who comes back in another tab, or whose storage is blocked, has
 * nothing remembered; the page says where to look instead of guessing.
 */
export function PaymentReturnPage() {
  useDocumentTitle("Pembayaran — GoShop");
  const [searchParams] = useSearchParams();
  const payment = findPaymentReturn(searchParams.get("order_id"));

  if (payment !== null) {
    return <Navigate to={paymentPath(payment.orderId)} replace />;
  }
  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Pembayaran
      </h1>
      <p>
        Terima kasih. Status pembayaran Anda diperbarui begitu GoShop menerima
        konfirmasi dari Midtrans; Anda juga akan mendapat email.
      </p>
      <p className="mt-2">
        <Link to={ORDERS_PATH}>Lihat pesanan saya</Link>
      </p>
    </Card>
  );
}
