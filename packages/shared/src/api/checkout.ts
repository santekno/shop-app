import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type { ShippingQuotes, ShippingQuotesDetail } from "./types.ts";

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
