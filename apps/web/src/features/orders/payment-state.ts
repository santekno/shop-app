/**
 * What the storefront remembers between "Bayar" and the buyer's return,
 * and what one page tells the next.
 */

/** The sessionStorage key of the payment the buyer left to pay. */
const RETURN_KEY = "goshop:payment-return";

/** The order a buyer left the storefront to pay at Midtrans. */
export interface PaymentReturn {
  orderId: string;
  code: string;
}

/**
 * Remembers which order the buyer is about to pay, before the browser
 * leaves for Midtrans. sessionStorage, not localStorage: it belongs to
 * this tab, and it survives the round trip to Midtrans and back in it.
 * It holds an order id and code, nothing secret (no token is ever
 * stored, ADR 0005). Blocked storage only means the return page cannot
 * tell which order it was, and sends the buyer to the order list.
 */
export const rememberPaymentReturn = (payment: PaymentReturn): void => {
  try {
    window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(payment));
  } catch {
    // Not remembered: the return page falls back to the order list.
  }
};

/**
 * The order remembered for the Midtrans `order_id` the buyer came back
 * with, or null. GoShop names each Midtrans transaction
 * `<order code>-<6 characters>` (ADR 0007), so the code must match up to
 * that suffix; a remembered order for another payment is not used.
 * Whatever is stored is untrusted (checked, not cast).
 *
 * It only reads. React's StrictMode calls a render-time function twice in
 * development, and a read that also deleted the entry would find nothing
 * the second time; the next payment overwrites the entry anyway.
 */
export const findPaymentReturn = (
  midtransOrderId: string | null,
): PaymentReturn | null => {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
  if (raw === null || midtransOrderId === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("orderId" in value) ||
    !("code" in value) ||
    typeof value.orderId !== "string" ||
    typeof value.code !== "string"
  ) {
    return null;
  }
  const { orderId, code } = value;
  return midtransOrderId === code || midtransOrderId.startsWith(`${code}-`)
    ? { orderId, code }
    : null;
};

/**
 * The navigation state the payment page reads: the server pays with the
 * test gateway (no page to send the buyer to), or the order was placed
 * but the payment could not be started (and why).
 */
export interface PaymentPageState {
  fakeProvider?: true;
  payError?: string;
}

/** The PaymentPageState in `state`, if any; history.state is checked, not cast. */
export const paymentPageState = (state: unknown): PaymentPageState => {
  if (typeof state !== "object" || state === null) return {};
  const result: PaymentPageState = {};
  if ("fakeProvider" in state && state.fakeProvider === true) {
    result.fakeProvider = true;
  }
  if ("payError" in state && typeof state.payError === "string") {
    result.payError = state.payError;
  }
  return result;
};
