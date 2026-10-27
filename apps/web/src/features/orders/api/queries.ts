import { queryOptions } from "@tanstack/react-query";
import { getOrder } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";

/**
 * The orders' query keys. Every one belongs to one logged-in buyer, so the
 * user's id is in each key, and a logout removes the whole prefix
 * (onSessionEnd in app/App.tsx).
 *
 *   ["orders"]                         everything (what a logout removes)
 *   ["orders", userId, "detail", id]   GET /v1/orders/{id}
 */
export const orderKeys = {
  all: ["orders"] as const,
  user: (userId: string) => [...orderKeys.all, userId] as const,
  detail: (userId: string, orderId: string) =>
    [...orderKeys.user(userId), "detail", orderId] as const,
};

/** One of the buyer's orders. */
export const orderQuery = (
  client: ApiClient,
  userId: string,
  orderId: string,
) =>
  queryOptions({
    queryKey: orderKeys.detail(userId, orderId),
    queryFn: ({ signal }) => getOrder(client, orderId, { signal }),
  });
