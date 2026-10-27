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

/** Fewer minutes than this before the deadline, and Midtrans takes no new payment (ADR 0007). */
const LAST_PAYABLE_MS = 2 * 60 * 1_000;

/**
 * Whether "Bayar" can still start a payment, judged at `now` (the time of
 * the API's last answer, not the render's clock): the API refuses with
 * PAYMENT_WINDOW_CLOSED when fewer than two minutes are left.
 */
export const canStartPayment = (
  order: Pick<Order, "status" | "payment_expires_at">,
  now: number,
): boolean =>
  order.status === "pending_payment" &&
  Date.parse(order.payment_expires_at) - now > LAST_PAYABLE_MS;
