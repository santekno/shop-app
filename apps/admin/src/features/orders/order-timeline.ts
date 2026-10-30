import type { Order, OrderStatus } from "@goshop/shared";
import { orderStatusText } from "./order-status.ts";

/** One step of the timeline. */
export interface TimelineStep {
  key: string;
  label: string;
  /** When it happened; null when the order does not record the time. */
  at: string | null;
  state: "done" | "current" | "upcoming";
}

const LIFE_CYCLE: readonly { status: OrderStatus; label: string }[] = [
  { status: "pending_payment", label: "Dipesan" },
  { status: "paid", label: "Dibayar" },
  { status: "processing", label: "Diproses" },
  { status: "shipped", label: "Dikirim" },
  { status: "completed", label: "Selesai" },
];

/** The time the order records for reaching `status`, if it records one. */
const timeOf = (order: Order, status: OrderStatus): string | null => {
  switch (status) {
    case "pending_payment":
      return order.created_at;
    case "paid":
      return order.paid_at;
    case "processing":
      // The contract has no processing_at: packing has no time of its own.
      return null;
    case "shipped":
      return order.shipped_at;
    case "completed":
      return order.completed_at;
    case "cancelled":
      return order.cancelled_at;
  }
};

/**
 * The order's way through its life cycle (ADR 0006), from what the order
 * records. A live order shows every step, the ones behind it done, its
 * own current, the rest still to come. A cancelled order shows only what
 * happened: ordered, paid if it was, and cancelled (it is not known
 * whether packing had started; the order keeps no time for that).
 */
export const timelineSteps = (order: Order): TimelineStep[] => {
  if (order.status === "cancelled") {
    const reached: TimelineStep[] = [
      {
        key: "pending_payment",
        label: "Dipesan",
        at: order.created_at,
        state: "done",
      },
    ];
    if (order.paid_at !== null) {
      reached.push({
        key: "paid",
        label: "Dibayar",
        at: order.paid_at,
        state: "done",
      });
    }
    reached.push({
      key: "cancelled",
      label: orderStatusText("cancelled", order.cancel_reason),
      at: order.cancelled_at,
      state: "current",
    });
    return reached;
  }
  const current = LIFE_CYCLE.findIndex((step) => step.status === order.status);
  return LIFE_CYCLE.map((step, index) => ({
    key: step.status,
    label: step.label,
    at: index <= current ? timeOf(order, step.status) : null,
    state:
      index < current ? "done" : index === current ? "current" : "upcoming",
  }));
};
