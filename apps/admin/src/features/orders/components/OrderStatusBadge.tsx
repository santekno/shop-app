import type { OrderCancelReason, OrderStatus } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { orderStatusText } from "../order-status.ts";

/**
 * Each status's look, from the shop's side: the two that ask for work
 * (paid: pack it; processing: ship it) stand out, a finished order is
 * green, a cancelled one red, and the rest are quiet. The word is always
 * there; the colour only repeats it (WCAG 1.4.1).
 */
const VARIANT = {
  pending_payment: "muted",
  paid: "default",
  processing: "default",
  shipped: "muted",
  completed: "success",
  cancelled: "destructive",
} as const satisfies Record<OrderStatus, string>;

interface OrderStatusBadgeProps {
  status: OrderStatus;
  /** Shown after "Dibatalkan" when the order says why. */
  cancelReason?: OrderCancelReason;
}

/** An order's status as a badge: "Dibayar", "Dibatalkan (dibatalkan pembeli)". */
export function OrderStatusBadge({
  status,
  cancelReason = null,
}: OrderStatusBadgeProps) {
  return (
    <Badge variant={VARIANT[status]}>
      {orderStatusText(status, cancelReason)}
    </Badge>
  );
}
