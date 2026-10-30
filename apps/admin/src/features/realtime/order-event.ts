import { formatRupiah } from "@goshop/shared";
import type { AdminOrderEvent } from "@goshop/shared";

const ORDER_EVENT_TYPES: ReadonlySet<string> = new Set<AdminOrderEvent["type"]>(
  [
    "order.created",
    "order.paid",
    "order.processing",
    "order.shipped",
    "order.completed",
    "order.cancelled",
  ],
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The `data` of an `order` event, checked at run time, or null when it is
 * not the contract's AdminOrderEvent. A type from the OpenAPI file is
 * erased at run time, so the JSON is looked at before it is trusted: an
 * event a newer API sends with a type this client does not know is
 * skipped (the next refetch shows its effect anyway).
 */
export const parseOrderEvent = (data: string): AdminOrderEvent | null => {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (!isObject(value) || !isObject(value.total)) return null;
  const { type, order_id, code, status, occurred_at, total } = value;
  if (
    typeof type !== "string" ||
    !ORDER_EVENT_TYPES.has(type) ||
    typeof order_id !== "string" ||
    typeof code !== "string" ||
    typeof status !== "string" ||
    typeof occurred_at !== "string" ||
    typeof total.amount !== "number" ||
    typeof total.currency !== "string"
  ) {
    return null;
  }
  return value as AdminOrderEvent;
};

/**
 * Whether the event can change the sales report (GET
 * /v1/admin/reports/sales). The report counts the orders paid in the range
 * that were not cancelled afterwards (status paid, processing, shipped or
 * completed), so only two changes move it: `order.paid` adds an order, and
 * `order.cancelled` may take one away (when it had been paid; the event
 * does not say, so every cancellation counts). `order.created` is not paid
 * yet, and processing → shipped → completed stay inside the counted set.
 */
export const changesSalesReport = (event: AdminOrderEvent): boolean =>
  event.type === "order.paid" || event.type === "order.cancelled";

/** Whether the event is a new order to work on: one that has just been paid. */
export const isNewPaidOrder = (event: AdminOrderEvent): boolean =>
  event.type === "order.paid";

/** The toast's text: "Pesanan baru GS-20261023-ABC123 · Rp 117.000". */
export const newOrderMessage = (event: AdminOrderEvent): string =>
  `Pesanan baru ${event.code} · ${formatRupiah(event.total)}`;
