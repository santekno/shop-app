import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { getOrder, listOrders } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";

/**
 * The orders' query keys. Every one belongs to one logged-in buyer, so the
 * user's id is in each key, and a logout removes the whole prefix
 * (onSessionEnd in components/layout/Providers.tsx).
 *
 *   ["orders"]                         everything (what a logout removes)
 *   ["orders", userId, "detail", id]   GET /v1/orders/{id}
 *   ["orders", userId, "list"]         GET /v1/orders, page by page
 */
export const orderKeys = {
  all: ["orders"] as const,
  user: (userId: string) => [...orderKeys.all, userId] as const,
  detail: (userId: string, orderId: string) =>
    [...orderKeys.user(userId), "detail", orderId] as const,
  list: (userId: string) => [...orderKeys.user(userId), "list"] as const,
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

/** How many orders one page of the history holds. */
export const ORDERS_PAGE_SIZE = 10;

/**
 * The buyer's order history, newest first, one page at a time: an
 * infinite query, as the catalog's product list (Bab 9). Each page's
 * `page.next_cursor` is the next page's cursor; null ends the list.
 *
 * `staleTime: 0`: the list is refetched every time the page is opened, so
 * an order paid a moment ago on the payment page does not show "Menunggu
 * pembayaran" here for the storefront's default half minute. A refetch of
 * an infinite query fetches each loaded page again, in order, so the
 * buyer does not lose the pages they loaded.
 */
export const ordersQuery = (client: ApiClient, userId: string) =>
  infiniteQueryOptions({
    queryKey: orderKeys.list(userId),
    queryFn: ({ pageParam, signal }) =>
      listOrders(
        client,
        { cursor: pageParam, limit: ORDERS_PAGE_SIZE },
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.next_cursor,
    staleTime: 0,
  });
