/** The buyer's order history (artikel 06). */
export const ORDERS_PATH = "/pesanan";

/**
 * The paths as patterns, for reading; Next.js takes the routes from the
 * folders (app/(akun)/pesanan/[id]/…), and useParams() reads `id` there.
 */
export const ORDER_ROUTE = "/pesanan/:id";
export const PAYMENT_ROUTE = "/pesanan/:id/pembayaran";

/**
 * Where Midtrans sends the buyer back after its hosted payment page. The
 * API asks for it with every transaction (`callbacks.finish`, from
 * APP_WEB_URL); with APP_WEB_URL empty, the dashboard's "Finish Redirect
 * URL" (Settings, Snap Preferences) must be
 * `<storefront origin>/pembayaran/selesai`. Midtrans adds `order_id`,
 * `status_code` and `transaction_status` to it.
 */
export const PAYMENT_RETURN_PATH = "/pembayaran/selesai";

/** The page of one order (artikel 06). The id is one path segment. */
export const orderPath = (orderId: string): string =>
  `${ORDERS_PATH}/${encodeURIComponent(orderId)}`;

/** The payment status page of one order (artikel 04–05). */
export const paymentPath = (orderId: string): string =>
  `${orderPath(orderId)}/pembayaran`;
