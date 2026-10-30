import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelOrder,
  completeOrder,
  processOrder,
  shipOrder,
} from "@goshop/shared";
import type { Order, ShipRequest } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { invalidateOrderQueries, orderKeys } from "../api/queries.ts";
import { actionFailure } from "../order-actions.ts";
import type { OrderAction } from "../order-actions.ts";

/** What one status change needs: which one, and the resi for "ship". */
export type OrderActionInput =
  | { action: "ship"; body: ShipRequest }
  | { action: Exclude<OrderAction, "ship"> };

/**
 * The four status changes of one order as one TanStack Query mutation:
 * `mutate({ action: "process" })`, `mutate({ action: "ship", body })`.
 * One mutation, not four, because an order makes one change at a time:
 * while one runs every button waits (`isPending`), and the page has one
 * error to show.
 *
 * The cache afterwards:
 *
 * - success: the API answered the order after the change, so it goes
 *   straight into the detail query (setQueryData), and every queue is
 *   marked stale (the order left one status for another). The queues are
 *   not awaited: none is on screen while the detail page is.
 * - 409 INVALID_TRANSITION or 404: the order on screen is out of date
 *   (someone else moved it, or it is gone). The detail and the queues are
 *   refetched, and the mutation settles only after that refetch, so the
 *   page shows the fresh order in the same render as the message that
 *   says so.
 * - "uncertain" (no answer, or a 5xx): the change may have been made
 *   without a usable answer arriving. The same refetch, not awaited: the page says to
 *   check the status at once, and shows it when the refetch lands.
 */
export const useOrderAction = (orderId: string) => {
  const { authApi } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderActionInput): Promise<Order> => {
      switch (input.action) {
        case "process":
          return processOrder(authApi, orderId);
        case "ship":
          return shipOrder(authApi, orderId, input.body);
        case "complete":
          return completeOrder(authApi, orderId);
        case "cancel":
          return cancelOrder(authApi, orderId);
      }
    },
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      void queryClient.invalidateQueries({ queryKey: orderKeys.queues });
    },
    onError: async (error) => {
      const failure = actionFailure(error);
      if (failure === "conflict" || failure === "gone") {
        await invalidateOrderQueries(queryClient, orderId);
      } else if (failure === "uncertain") {
        // Not awaited: the server that did not answer the change may not
        // answer this refetch quickly either, and the seller should read
        // "check the status" now. The status updates when it arrives.
        void invalidateOrderQueries(queryClient, orderId);
      }
    },
  });
};
