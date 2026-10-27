import { queryOptions } from "@tanstack/react-query";
import { getShippingQuotes, listAddresses } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";

/**
 * The checkout's query keys. Everything here belongs to one logged-in
 * buyer, so the user's id is in every key, and a logout removes the whole
 * prefix (onSessionEnd in app/App.tsx).
 *
 *   ["checkout"]                                 everything (what a logout removes)
 *   ["checkout", userId, "addresses"]            GET /v1/me/addresses
 *   ["checkout", userId, "quotes", addressId]    GET /v1/checkout/shipping-quotes
 */
export const checkoutKeys = {
  all: ["checkout"] as const,
  user: (userId: string) => [...checkoutKeys.all, userId] as const,
  addresses: (userId: string) =>
    [...checkoutKeys.user(userId), "addresses"] as const,
  quotes: (userId: string, addressId: string) =>
    [...checkoutKeys.user(userId), "quotes", addressId] as const,
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
