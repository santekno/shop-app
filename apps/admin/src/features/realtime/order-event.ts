import { formatRupiah } from "@goshop/shared";
import type { AdminOrderEvent } from "@goshop/shared";

/**
 * The prefix of every admin order query: invalidating it refetches the
 * queue, the tabs' counts and an open order's detail at once.
 *
 * Artikel 06 (the order queue) owns the real query keys; until both are
 * merged this is the prefix its key factory is expected to start with.
 * When they meet, this should come from that factory (its `all` key)
 * instead of being written twice.
 */
export const ADMIN_ORDERS_QUERY_KEY = ["admin", "orders"] as const;

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

/** Whether the event is a new order to work on: one that has just been paid. */
export const isNewPaidOrder = (event: AdminOrderEvent): boolean =>
  event.type === "order.paid";

/** The toast's text: "Pesanan baru GS-20261023-ABC123 · Rp 117.000". */
export const newOrderMessage = (event: AdminOrderEvent): string =>
  `Pesanan baru ${event.code} · ${formatRupiah(event.total)}`;
