import { useInfiniteQuery } from "@tanstack/react-query";
import type { OrderStatus } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { orderQueueQuery } from "../api/queries.ts";

/** One status's order queue, page by page, fetched as the logged-in user. */
export const useOrderQueue = (status: OrderStatus) => {
  const { authApi } = useSession();
  return useInfiniteQuery(orderQueueQuery(authApi, status));
};
