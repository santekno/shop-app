import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { Order } from "@goshop/shared";
import { formatDateTime } from "../format.ts";
import {
  paymentAttempt,
  paymentEndedUnpaid,
  paymentOutcome,
} from "../order-status.ts";
import type { PaymentAttempt } from "../order-status.ts";

/**
 * The sentence for an order that still waits, by what became of the last
 * attempt to pay it. A refused payment does not end the order (ADR 0007):
 * the buyer may pay again, so the sentence says so.
 */
const WAITING_TEXT: Record<PaymentAttempt, string> = {
  none: "Menunggu pembayaran.",
  open: "Menunggu pembayaran.",
  confirming: "Pembayaran sedang dikonfirmasi…",
  denied:
    "Pembayaran ditolak. Coba lagi, dengan metode pembayaran lain bila perlu.",
  failed: "Pembayaran gagal diproses. Silakan coba lagi.",
  cancelled: "Pembayaran dibatalkan. Anda masih bisa membayar pesanan ini.",
  expired:
    "Sesi pembayaran sebelumnya habis waktunya. Anda masih bisa membayar pesanan ini.",
};

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
  const attempt = paymentAttempt(order);
  const deadlinePassed = Date.parse(order.payment_expires_at) <= checkedAt;
  // Only while the order may still be paid: past the deadline the expiry
  // job decides, whatever the last attempt was.
  const refused =
    outcome === "pending" && !deadlinePassed && paymentEndedUnpaid(attempt);

  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-4">
      {outcome === "paid" && (
        <CheckCircle2 aria-hidden="true" className="mt-0.5 text-success" />
      )}
      {outcome === "pending" && !refused && (
        <Clock aria-hidden="true" className="mt-0.5 text-muted-foreground" />
      )}
      {refused && (
        <AlertTriangle aria-hidden="true" className="mt-0.5 text-destructive" />
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
              : WAITING_TEXT[attempt])}
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
