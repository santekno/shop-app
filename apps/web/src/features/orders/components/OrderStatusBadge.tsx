import type { Order } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { ORDER_STATUS_LABEL } from "../order-status.ts";

/**
 * An order's status as a small label. Waiting for payment is the one
 * status that asks something of the buyer, so it stands out (primary);
 * a cancelled order is red; every other status is quiet (muted). The
 * colour only repeats what the text says (WCAG 1.4.1).
 */
export function OrderStatusBadge({ status }: Pick<Order, "status">) {
  const variant =
    status === "pending_payment"
      ? "default"
      : status === "cancelled"
        ? "destructive"
        : "muted";
  return (
    <Badge variant={variant} className="order-status">
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}
