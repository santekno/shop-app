import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  CheckoutRequest,
  Order,
  OrderDetail,
  PaymentSession,
  PaymentSessionDetail,
} from "./types.ts";

/** Options of POST /v1/checkout. */
export interface PlaceOrderOptions extends EndpointOptions {
  /**
   * The Idempotency-Key header: 1–255 printable ASCII characters, a new
   * UUID per checkout attempt. Every retry of the same attempt (a timeout,
   * a lost connection, IDEMPOTENCY_IN_PROGRESS) must send the same key and
   * the same body: the API then answers the first order instead of making
   * a second one.
   */
  idempotencyKey: string;
  /** Overrides the client's timeout for this one request. */
  timeoutMs?: number;
}

const orderPath = (orderId: string): string =>
  `/v1/orders/${encodeURIComponent(orderId)}`;

/**
 * POST /v1/checkout: places an order from the logged-in user's cart (the
 * lines come from the server's cart, never from the body) and answers it,
 * waiting for payment. The ordered lines leave the cart.
 *
 * The client never retries a POST by itself; a caller that retries passes
 * the same `idempotencyKey`, and a retry of a finished checkout gets the
 * original order back (with `Idempotency-Replayed: true`). Throws
 * CHECKOUT_PROBLEMS, CART_EMPTY, CART_CHANGED, VOUCHER_NOT_APPLICABLE,
 * TOO_MANY_PENDING_ORDERS, IDEMPOTENCY_IN_PROGRESS (retry in a moment),
 * IDEMPOTENCY_KEY_REUSED (same key, another body), EMAIL_UNVERIFIED,
 * SHIPPING_UNAVAILABLE, UPSTREAM_UNAVAILABLE, VALIDATION_FAILED or
 * RATE_LIMITED. A failed checkout changes nothing and frees its key.
 */
export const placeOrder = async (
  api: ApiClient,
  order: CheckoutRequest,
  { idempotencyKey, signal, timeoutMs }: PlaceOrderOptions,
): Promise<Order> => {
  const body = await api.request<OrderDetail>("/v1/checkout", {
    method: "POST",
    body: order,
    headers: { "Idempotency-Key": idempotencyKey },
    signal,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return body.data;
};

/**
 * GET /v1/orders/{id}: one of the logged-in user's orders, with its lines,
 * totals and shipping address copy. Another user's order, and an id that
 * is not a UUID, throw NOT_FOUND exactly like a missing one.
 */
export const getOrder = async (
  api: ApiClient,
  orderId: string,
  { signal }: EndpointOptions = {},
): Promise<Order> => {
  const body = await api.request<OrderDetail>(orderPath(orderId), { signal });
  return body.data;
};

/**
 * POST /v1/orders/{id}/pay: starts (or resumes) paying an unpaid order.
 * Answers the Snap transaction: `redirect_url` (Midtrans' hosted page),
 * `token` and `client_key` (for Snap.js), and `provider`, which is "fake"
 * where the server runs the test gateway: its redirect_url leads nowhere,
 * and the order is paid from a terminal (`make fake-pay`).
 *
 * Idempotent per order: while a payment is open the same one comes back
 * (200); after a denied, cancelled or failed one a new one is made (201).
 * Throws INVALID_TRANSITION (the order no longer waits for payment),
 * PAYMENT_WINDOW_CLOSED (less than two minutes left), PAYMENTS_DISABLED,
 * UPSTREAM_UNAVAILABLE or RATE_LIMITED (10 a minute).
 */
export const payOrder = async (
  api: ApiClient,
  orderId: string,
  { signal }: EndpointOptions = {},
): Promise<PaymentSession> => {
  const body = await api.request<PaymentSessionDetail>(
    `${orderPath(orderId)}/pay`,
    { method: "POST", signal },
  );
  return body.data;
};
