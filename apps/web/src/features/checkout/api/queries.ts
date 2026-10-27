import { queryOptions } from "@tanstack/react-query";
import {
  getShippingQuotes,
  listAddresses,
  previewCheckout,
} from "@goshop/shared";
import type { ApiClient, Cart, CheckoutPreviewRequest } from "@goshop/shared";

/**
 * The checkout's query keys. Everything here belongs to one logged-in
 * buyer, so the user's id is in every key, and a logout removes the whole
 * prefix (onSessionEnd in app/App.tsx).
 *
 *   ["checkout"]                                 everything (what a logout removes)
 *   ["checkout", userId, "addresses"]            GET /v1/me/addresses
 *   ["checkout", userId, "quotes", addressId]    GET /v1/checkout/shipping-quotes
 *   ["checkout", userId, "preview", cart, choice] POST /v1/checkout/preview
 */
export const checkoutKeys = {
  all: ["checkout"] as const,
  user: (userId: string) => [...checkoutKeys.all, userId] as const,
  addresses: (userId: string) =>
    [...checkoutKeys.user(userId), "addresses"] as const,
  quotes: (userId: string, addressId: string) =>
    [...checkoutKeys.user(userId), "quotes", addressId] as const,
  previews: (userId: string) =>
    [...checkoutKeys.user(userId), "preview"] as const,
  preview: (userId: string, cart: string, choice: CheckoutPreviewRequest) =>
    [...checkoutKeys.previews(userId), cart, choice] as const,
};

/** The buyer's addresses, the default first. */
export const addressesQuery = (client: ApiClient, userId: string) =>
  queryOptions({
    queryKey: checkoutKeys.addresses(userId),
    queryFn: ({ signal }) => listAddresses(client, { signal }),
  });

/**
 * The courier services for the buyer's cart to one address. Kept fresh
 * for the storefront's default half minute: a quote is a hint (checkout
 * asks the courier again), and preview, quotes and checkout share one
 * rate limit per buyer, so the page should not ask more often than that.
 */
export const shippingQuotesQuery = (
  client: ApiClient,
  userId: string,
  addressId: string,
) =>
  queryOptions({
    queryKey: checkoutKeys.quotes(userId, addressId),
    queryFn: ({ signal }) => getShippingQuotes(client, addressId, { signal }),
  });

/**
 * The order as checkout would price it now, for what the buyer has chosen
 * (address, courier service, voucher). A query, not a mutation, although
 * it is a POST: it writes nothing, its answer is data the page shows, and
 * the same choice should hit the same cache entry (the choice is the
 * key, so changing the courier and changing it back costs no request).
 *
 * The cart is not sent (the API reads the buyer's own cart), but it is in
 * the key, as `cartSignature`: a cart changed on another tab or device
 * is another preview, not a cached one that no longer adds up.
 */
export const previewQuery = (
  client: ApiClient,
  userId: string,
  cartSignature: string,
  choice: CheckoutPreviewRequest,
) =>
  queryOptions({
    queryKey: checkoutKeys.preview(userId, cartSignature, choice),
    queryFn: ({ signal }) => previewCheckout(client, choice, { signal }),
  });

/**
 * What the preview depends on in the cart: each line's variant, quantity
 * and the price the buyer accepted. A refetch that brings the same cart
 * back gives the same signature, so it costs no new preview.
 */
export const cartSignature = (cart: Cart | undefined): string =>
  cart === undefined
    ? ""
    : cart.lines
        .map(
          (line) =>
            `${line.variant_id}:${String(line.quantity)}:${String(line.price_when_added.amount)}`,
        )
        .join(",");
