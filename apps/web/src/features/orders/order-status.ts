import type { Order, OrderStatus } from "@goshop/shared";

/** Each order status as a buyer reads it (the life cycle of ADR 0006). */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses penjual",
  shipped: "Dikirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

/** Why an order was cancelled, as a buyer reads it. */
const CANCEL_REASON_LABEL: Record<
  NonNullable<Order["cancel_reason"]>,
  string
> = {
  payment_expired: "Waktu pembayaran habis",
  buyer_cancelled: "Dibatalkan oleh Anda",
  seller_cancelled: "Dibatalkan oleh penjual",
};

/** "Dibatalkan" with its reason when the API gives one. */
export const orderStatusText = (
  order: Pick<Order, "status" | "cancel_reason">,
): string =>
  order.status === "cancelled" && order.cancel_reason !== null
    ? `${ORDER_STATUS_LABEL.cancelled}: ${CANCEL_REASON_LABEL[order.cancel_reason].toLowerCase()}`
    : ORDER_STATUS_LABEL[order.status];

/**
 * What the payment of an order has come to, as far as the API has
 * decided. Only "pending" can still change by itself: the webhook or the
 * reconciler moves an order out of it (paid, or cancelled when the
 * payment expired), so it is the only state worth polling.
 */
export type PaymentOutcome = "pending" | "paid" | "expired" | "cancelled";

export const paymentOutcome = (
  order: Pick<Order, "status" | "cancel_reason">,
): PaymentOutcome => {
  switch (order.status) {
    case "pending_payment":
      return "pending";
    case "cancelled":
      return order.cancel_reason === "payment_expired"
        ? "expired"
        : "cancelled";
    case "paid":
    case "processing":
    case "shipped":
    case "completed":
      // The money arrived; what happens next is the seller's.
      return "paid";
  }
};

/**
 * What became of the buyer's last attempt to pay an order that still
 * waits (`pending_payment`), from the order's `latest_payment`:
 *
 * - "none": no payment started yet;
 * - "open": Midtrans still decides (`pending`, `challenge`);
 * - "confirming": Midtrans says paid, and the order has not caught up yet
 *   (latest_payment is read just after the order, so it may be newer,
 *   never older): the next poll will say "paid". No second payment now;
 * - "denied", "failed", "cancelled": it ended without money, and the
 *   order may be paid again until its deadline (ADR 0007);
 * - "expired": that payment's own window closed, the order's has not.
 *
 * Refunds cannot happen to an unpaid order; they read as "none".
 */
export type PaymentAttempt =
  | "none"
  | "open"
  | "confirming"
  | "denied"
  | "failed"
  | "cancelled"
  | "expired";

export const paymentAttempt = (
  order: Pick<Order, "latest_payment">,
): PaymentAttempt => {
  const payment = order.latest_payment;
  if (payment === null) return "none";
  switch (payment.status) {
    case "pending":
    case "challenge":
      return "open";
    case "paid":
      return "confirming";
    case "denied":
    case "failed":
    case "cancelled":
    case "expired":
      return payment.status;
    case "refunded":
    case "partially_refunded":
      return "none";
  }
};

/** An attempt that ended without money: the buyer should pay again. */
export const paymentEndedUnpaid = (attempt: PaymentAttempt): boolean =>
  attempt === "denied" ||
  attempt === "failed" ||
  attempt === "cancelled" ||
  attempt === "expired";

/** Fewer minutes than this before the deadline, and Midtrans takes no new payment (ADR 0007). */
const LAST_PAYABLE_MS = 2 * 60 * 1_000;

/**
 * Whether "Bayar" can still start a payment, judged at `now` (the time of
 * the API's last answer, not the render's clock): the API refuses with
 * PAYMENT_WINDOW_CLOSED when fewer than two minutes are left. Never while
 * Midtrans has said paid and the order is catching up: a second payment
 * would charge the buyer twice.
 */
export const canStartPayment = (
  order: Pick<Order, "status" | "payment_expires_at" | "latest_payment">,
  now: number,
): boolean =>
  order.status === "pending_payment" &&
  paymentAttempt(order) !== "confirming" &&
  Date.parse(order.payment_expires_at) - now > LAST_PAYABLE_MS;

/** The pay button's text for an order that may be paid. */
export const payButtonText = (order: Pick<Order, "latest_payment">): string => {
  const attempt = paymentAttempt(order);
  if (attempt === "open") return "Lanjutkan pembayaran";
  if (paymentEndedUnpaid(attempt)) return "Coba bayar lagi";
  return "Bayar sekarang";
};
