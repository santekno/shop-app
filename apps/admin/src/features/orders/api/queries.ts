import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getAdminOrder, listAdminOrders } from "@goshop/shared";
import type { ApiClient, OrderStatus } from "@goshop/shared";

/**
 * The query keys of the orders section, in one place. Every key starts
 * with ["admin", "orders"], so one prefix reaches every order query the
 * dashboard holds:
 *
 *   ["admin", "orders"]                               everything below
 *   ["admin", "orders", "queue"]                      every status's queue
 *   ["admin", "orders", "queue", status]              one queue (all its pages)
 *   ["admin", "orders", "detail"]                     every order's detail
 *   ["admin", "orders", "detail", id]                 one order
 *
 * The detail page, the print view and artikel 09's live events all use
 * these and nothing else: an event about any order invalidates
 * `orderKeys.all` (see invalidateOrderQueries).
 */
export const orderKeys = {
  all: ["admin", "orders"] as const,
  queues: ["admin", "orders", "queue"] as const,
  queue: (status: OrderStatus) => [...orderKeys.queues, status] as const,
  details: ["admin", "orders", "detail"] as const,
  detail: (id: string) => [...orderKeys.details, id] as const,
};

/** Orders per page of a queue: the API's default, a screenful. */
export const QUEUE_PAGE_SIZE = 20;

/**
 * One status's queue (GET /v1/admin/orders) as an infinite query: the
 * pages loaded so far, each fetched with the previous page's
 * `next_cursor`. "Muat lebih banyak" is fetchNextPage; the button goes
 * away when `next_cursor` is null (getNextPageParam returns undefined,
 * so hasNextPage is false). A page may be empty while a cursor still
 * follows (the contract says so), which the button handles like any page.
 *
 * Why cursors and not page numbers, unlike the product table: a queue
 * changes while it is read (orders are paid, packed, shipped), and an
 * offset would skip or repeat orders when one leaves the status between
 * two pages. A cursor continues after the last order seen.
 *
 * A refetch (after an action, or an event in artikel 09) refetches every
 * loaded page in turn, from the first, so the list stays one consistent
 * list instead of pages from two moments.
 */
export const orderQueueQuery = (client: ApiClient, status: OrderStatus) =>
  infiniteQueryOptions({
    queryKey: orderKeys.queue(status),
    queryFn: ({ pageParam, signal }) =>
      listAdminOrders(
        client,
        { status, cursor: pageParam, limit: QUEUE_PAGE_SIZE },
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.next_cursor ?? undefined,
  });

/** GET /v1/admin/orders/{id}: one order with its lines, any buyer's. */
export const adminOrderQuery = (client: ApiClient, id: string) =>
  queryOptions({
    queryKey: orderKeys.detail(id),
    queryFn: ({ signal }) => getAdminOrder(client, id, { signal }),
  });

/**
 * Marks order queries stale and refetches the ones on screen. With an
 * `orderId`, that order's detail and every queue (it left one status for
 * another, so two queues changed); without one, every order query (artikel
 * 09 calls it so for each event, and after a reconnect).
 *
 * Resolves when the refetches on screen are done, so a caller can await
 * the fresh order before it says "data terbaru dimuat".
 */
export const invalidateOrderQueries = async (
  queryClient: QueryClient,
  orderId?: string,
): Promise<void> => {
  if (orderId === undefined) {
    await invalidateWithoutCancelling(queryClient, orderKeys.all);
    return;
  }
  await Promise.all([
    invalidateWithoutCancelling(queryClient, orderKeys.queues),
    invalidateWithoutCancelling(queryClient, orderKeys.detail(orderId)),
  ]);
};

/**
 * invalidateQueries, except that a fetch already on its way is not
 * cancelled: it is allowed to finish, and then its query is refetched.
 *
 * By default TanStack Query cancels a running fetch and starts a refetch
 * (`cancelRefetch: true`). For an infinite query that loses work when the
 * running fetch is "Muat lebih banyak": a refetch reloads only the pages
 * already in the cache, so the page being loaded is dropped and the queue
 * falls back to page 1. An event (or a reconnect) a moment after the press
 * did exactly that. So the running fetch is kept (`cancelRefetch: false`
 * joins it instead). It started before this invalidation, though, and a
 * next page refreshes only itself, so such a query is invalidated once
 * more when it is done: the pages before it are reloaded too, and the list
 * is again one list from one moment.
 */
const invalidateWithoutCancelling = async (
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<void> => {
  const running = queryClient
    .getQueryCache()
    .findAll({ queryKey, fetchStatus: "fetching" });
  await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  await Promise.all(
    running.map((query) =>
      queryClient.invalidateQueries(
        { queryKey: query.queryKey, exact: true },
        { cancelRefetch: false },
      ),
    ),
  );
};
