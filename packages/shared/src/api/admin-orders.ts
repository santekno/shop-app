import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  ListAdminOrdersQuery,
  Order,
  OrderDetail,
  OrderList,
  ShipRequest,
} from "./types.ts";

/**
 * GET /v1/admin/orders: one page of the order queue of one status, newest
 * first, without the lines. `paid` when `status` is left out: the orders
 * to pack. Cursor pagination as in the catalog: pass `page.next_cursor`
 * back as `cursor` (for the same status), and stop when it is null.
 *
 * Staff only (seller or admin), so `api` must send the access token (the
 * dashboard's `authApi`). Throws VALIDATION_FAILED for an unknown status
 * or a cursor made for another status, UNAUTHORIZED, or FORBIDDEN for a
 * buyer.
 *
 * @example
 *   const first = await listAdminOrders(authApi, { status: "processing" });
 *   const next = await listAdminOrders(authApi, {
 *     status: "processing",
 *     cursor: first.page.next_cursor,
 *   });
 */
export const listAdminOrders = (
  api: ApiClient,
  { status, cursor, limit }: ListAdminOrdersQuery = {},
  { signal }: EndpointOptions = {},
): Promise<OrderList> =>
  api.request<OrderList>("/v1/admin/orders", {
    query: { status, cursor: cursor ?? undefined, limit },
    signal,
  });

/** The path of one order; the ID is escaped, so a pasted URL stays a path. */
const adminOrderPath = (id: string) =>
  `/v1/admin/orders/${encodeURIComponent(id)}`;

/**
 * GET /v1/admin/orders/{id}: any buyer's order, with its lines, totals,
 * shipping (courier, service, tracking number, the address copied at
 * checkout) and newest payment. Throws NOT_FOUND for an unknown ID (or one
 * that is not a UUID).
 */
export const getAdminOrder = async (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<Order> => {
  const body = await api.request<OrderDetail>(adminOrderPath(id), { signal });
  return body.data;
};

/** POST to one of an order's status changes; answers the changed order. */
const moveOrder = async (
  api: ApiClient,
  id: string,
  action: "process" | "ship" | "complete" | "cancel",
  body: ShipRequest | undefined,
  signal: AbortSignal | undefined,
): Promise<Order> => {
  const response = await api.request<OrderDetail>(
    `${adminOrderPath(id)}/${action}`,
    { method: "POST", body, signal },
  );
  return response.data;
};

/*
 * The four status changes a seller or an admin makes (ADR 0006):
 *
 *   paid ──process──▶ processing ──ship──▶ shipped ──complete──▶ completed
 *   pending_payment, paid, processing ──cancel──▶ cancelled
 *
 * Each answers the order after the change. Each throws INVALID_TRANSITION
 * (409, `details.status` is the order's status now, `details.to` the one
 * asked for) when the order is no longer where the change starts: someone
 * else moved it first, because every change is one conditional UPDATE.
 * Also NOT_FOUND, UNAUTHORIZED and FORBIDDEN. Never retried by the
 * client, like every POST; repeating one after a lost answer is harmless
 * anyway (the second gets INVALID_TRANSITION).
 */

/** POST /v1/admin/orders/{id}/process: paid → processing (packing starts). */
export const processOrder = (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<Order> => moveOrder(api, id, "process", undefined, signal);

/**
 * POST /v1/admin/orders/{id}/ship: processing → shipped, with the
 * courier's airway bill (the resi). The courier itself was chosen by the
 * buyer at checkout and is not sent. The API trims the tracking number and
 * stores it upper-case; it must be 6–40 letters, digits or hyphens
 * (VALIDATION_FAILED, `details.tracking_number`, otherwise).
 */
export const shipOrder = (
  api: ApiClient,
  id: string,
  body: ShipRequest,
  { signal }: EndpointOptions = {},
): Promise<Order> => moveOrder(api, id, "ship", body, signal);

/** POST /v1/admin/orders/{id}/complete: shipped → completed (received). */
export const completeOrder = (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<Order> => moveOrder(api, id, "complete", undefined, signal);

/**
 * POST /v1/admin/orders/{id}/cancel: pending_payment, paid or processing
 * → cancelled (`seller_cancelled`); the stock and the voucher use go back.
 * A paid order's money is not refunded by this call. **Admin only** since
 * Bab 12: a seller gets FORBIDDEN (403), checked before the order is
 * looked up.
 */
export const cancelOrder = (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<Order> => moveOrder(api, id, "cancel", undefined, signal);
