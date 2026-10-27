import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import { isApiError } from "./errors.ts";
import type {
  CheckoutPreview,
  CheckoutPreviewDetail,
  CheckoutPreviewRequest,
  CheckoutProblem,
  ShippingQuotes,
  ShippingQuotesDetail,
} from "./types.ts";

/**
 * GET /v1/checkout/shipping-quotes: every courier service that can carry
 * the logged-in user's cart to one of their addresses, cheapest first.
 * A quote is not a reservation: checkout asks the courier again. Throws
 * SHIPPING_UNAVAILABLE (no courier serves the postal code; another
 * address might), UPSTREAM_UNAVAILABLE (the rates service did not answer;
 * retry shortly), CART_EMPTY, VALIDATION_FAILED (not one of the caller's
 * addresses) or RATE_LIMITED (preview, quotes and checkout share a limit
 * per buyer per minute).
 */
export const getShippingQuotes = async (
  api: ApiClient,
  addressId: string,
  { signal }: EndpointOptions = {},
): Promise<ShippingQuotes> => {
  const body = await api.request<ShippingQuotesDetail>(
    "/v1/checkout/shipping-quotes",
    { query: { address_id: addressId }, signal },
  );
  return body.data;
};

/**
 * POST /v1/checkout/preview: validates the caller's cart exactly as
 * checkout will and computes the totals, without writing anything. Every
 * field of the body is optional: without `courier` and `service` the
 * shipping fee is 0 and `shipping` is null; without `voucher_code` the
 * discount is 0. The totals are the API's (whole rupiah, the discount
 * rounded once on the server): show them, never compute them.
 *
 * Throws CHECKOUT_PROBLEMS (see checkoutProblems), VOUCHER_NOT_APPLICABLE
 * (`details.reason`), CART_EMPTY, SHIPPING_UNAVAILABLE,
 * UPSTREAM_UNAVAILABLE, VALIDATION_FAILED or RATE_LIMITED. It writes
 * nothing, but it is a POST, so the client does not retry it.
 */
export const previewCheckout = async (
  api: ApiClient,
  choice: CheckoutPreviewRequest,
  { signal }: EndpointOptions = {},
): Promise<CheckoutPreview> => {
  const body = await api.request<CheckoutPreviewDetail>(
    "/v1/checkout/preview",
    { method: "POST", body: choice, signal },
  );
  return body.data;
};

const PROBLEMS = new Set<string>([
  "unavailable",
  "insufficient_stock",
  "price_changed",
]);

const isMoney = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "amount" in value &&
  typeof value.amount === "number";

/** A run-time check of one `details.lines` entry (CheckoutProblem). */
const isCheckoutProblem = (value: unknown): value is CheckoutProblem => {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.variant_id === "string" &&
    typeof line.sku === "string" &&
    typeof line.problem === "string" &&
    PROBLEMS.has(line.problem) &&
    typeof line.quantity === "number" &&
    typeof line.available === "number" &&
    isMoney(line.unit_price) &&
    isMoney(line.price_when_added)
  );
};

/**
 * The lines of a 409 CHECKOUT_PROBLEMS, or null for any other error.
 *
 * `details` is typed `Record<string, unknown>` in every ApiError: the
 * client cannot know which code it will get, so it cannot type them in
 * advance. This function is the run-time check that turns the details of
 * this one code into the contract's CheckoutProblem[]. An entry that does
 * not have that shape is left out rather than trusted.
 */
export const checkoutProblems = (error: unknown): CheckoutProblem[] | null => {
  if (!isApiError(error, "CHECKOUT_PROBLEMS")) return null;
  const { lines } = error.details;
  return Array.isArray(lines) ? lines.filter(isCheckoutProblem) : [];
};
