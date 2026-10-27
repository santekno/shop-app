/** The buyer's order history (artikel 06). */
export const ORDERS_PATH = "/pesanan";

/** The route patterns; useParams() reads `id` from them. */
export const ORDER_ROUTE = "/pesanan/:id";
export const PAYMENT_ROUTE = "/pesanan/:id/pembayaran";

/**
 * Where Midtrans sends the buyer back after its hosted payment page: the
 * "Finish Redirect URL" in the Midtrans dashboard (Settings, Snap
 * Preferences) is `<storefront origin>/pembayaran/selesai`. Midtrans adds
 * `order_id`, `status_code` and `transaction_status` to it.
 */
export const PAYMENT_RETURN_PATH = "/pembayaran/selesai";

/** The page of one order (artikel 06). The id is one path segment. */
export const orderPath = (orderId: string): string =>
  `${ORDERS_PATH}/${encodeURIComponent(orderId)}`;

/** The payment status page of one order (artikel 04–05). */
export const paymentPath = (orderId: string): string =>
  `${orderPath(orderId)}/pembayaran`;
