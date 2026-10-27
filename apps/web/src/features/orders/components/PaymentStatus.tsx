import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Order } from "@goshop/shared";
import { formatDateTime } from "../format.ts";
import { paymentOutcome } from "../order-status.ts";

/**
 * The payment's state as the API has decided it (Bab 11 artikel 05).
 *
 * One live region (role="status"), always rendered, holding only the
 * sentence that matters: it is announced when the answer changes
 * ("Menunggu pembayaran" to "Pembayaran diterima"), and not at every poll,
 * because a poll that brings the same answer renders the same text.
 */
export function PaymentStatus({
  order,
  checkedAt,
}: {
  order: Order;
  /** When the API last answered (the query's dataUpdatedAt). */
  checkedAt: number;
}) {
  const outcome = paymentOutcome(order);
  const deadlinePassed = Date.parse(order.payment_expires_at) <= checkedAt;

  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-4">
      {outcome === "paid" && (
        <CheckCircle2 aria-hidden="true" className="mt-0.5 text-success" />
      )}
      {outcome === "pending" && (
        <Clock aria-hidden="true" className="mt-0.5 text-muted-foreground" />
      )}
      {(outcome === "expired" || outcome === "cancelled") && (
        <XCircle aria-hidden="true" className="mt-0.5 text-destructive" />
      )}
      <div className="grid gap-1">
        <p role="status" className="payment-status font-semibold">
          {outcome === "paid" && "Pembayaran diterima. Terima kasih!"}
          {outcome === "pending" &&
            (deadlinePassed
              ? "Batas waktu pembayaran sudah lewat. Menunggu konfirmasi akhir…"
              : "Menunggu pembayaran.")}
          {outcome === "expired" &&
            "Waktu pembayaran habis. Pesanan dibatalkan dan stoknya dikembalikan."}
          {outcome === "cancelled" && "Pesanan ini dibatalkan."}
        </p>
        {outcome === "pending" && !deadlinePassed && (
          <p className="text-sm text-muted-foreground">
            Bayar sebelum {formatDateTime(order.payment_expires_at)}. Halaman
            ini diperbarui sendiri begitu pembayaran Anda dikonfirmasi.
          </p>
        )}
        {outcome === "paid" && order.paid_at !== null && (
          <p className="text-sm text-muted-foreground">
            Dibayar {formatDateTime(order.paid_at)}. Penjual akan segera
            memproses pesanan Anda.
          </p>
        )}
      </div>
    </div>
  );
}
