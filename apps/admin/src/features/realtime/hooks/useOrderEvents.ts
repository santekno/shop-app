import { createUrlBuilder } from "@goshop/shared";
import type { AdminOrderEvent } from "@goshop/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { config } from "@/config.ts";
import { useSession } from "@/features/auth/session-context.ts";
import { createEventConnection } from "../connection.ts";
import type { ConnectionStatus, EventConnection } from "../connection.ts";
import { ADMIN_ORDERS_QUERY_KEY, parseOrderEvent } from "../order-event.ts";
import { createRecentIds } from "../recent-ids.ts";

const EVENTS_URL = createUrlBuilder(config.apiUrl)("/v1/admin/events");

/**
 * How long events are gathered before the order queries are refetched.
 * The worker publishes the outbox every 5 seconds, so events come in
 * bursts: ten orders paid in one run are one refetch, not ten (each of
 * which would cancel the one before).
 */
export const INVALIDATE_DELAY_MS = 250;

export interface UseOrderEventsOptions {
  /**
   * Each order event, once: duplicates (the same `id` again) and events
   * that do not match the contract are already dropped. `id` is the
   * outbox event's ID. Always the latest function passed is called.
   */
  onOrderEvent?: (event: AdminOrderEvent, id: string) => void;
}

/**
 * The dashboard's live order events (GET /v1/admin/events, ADR 0009):
 * opens the stream while a staff session exists and closes it when the
 * component unmounts (logging out unmounts the dashboard). Call it once
 * per tab: OrderEventsProvider does, in the dashboard's layout.
 *
 * - **Refetch after every connect.** The stream has no replay: whatever
 *   happened while it was closed (before the first connect too) is only
 *   seen by asking again. So each time it opens, the admin order queries
 *   are invalidated; the API answers 200 only once it listens, so nothing
 *   falls in between.
 * - **Refetch on every order event**, gathered over INVALIDATE_DELAY_MS.
 *   The event says which order changed, but the queue's tabs, counts and
 *   pages depend on all of them: refetching is simpler and always right.
 * - **At least once:** an `id` seen before is dropped (a bounded set of
 *   the last 500, kept across reconnects).
 * - Coming back online cuts a reconnect wait short.
 *
 * Returns the connection's status, and `retryNow` for a "Coba lagi".
 */
export const useOrderEvents = ({
  onOrderEvent,
}: UseOrderEventsOptions = {}) => {
  const { session, tokens } = useSession();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  // One set for the life of the tab: a duplicate may straddle a reconnect.
  const [seen] = useState(() => createRecentIds());
  const connectionRef = useRef<EventConnection | null>(null);

  const handleOrderEvent = useEffectEvent(
    (event: AdminOrderEvent, id: string) => {
      onOrderEvent?.(event, id);
    },
  );

  useEffect(() => {
    if (userId === null) return;

    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidateOrders = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = undefined;
        void queryClient.invalidateQueries({
          queryKey: ADMIN_ORDERS_QUERY_KEY,
        });
      }, INVALIDATE_DELAY_MS);
    };

    const connection = createEventConnection({
      url: EVENTS_URL,
      tokens,
      onStatus: setStatus,
      onOpen: invalidateOrders,
      onEvent: (event) => {
        if (event.type !== "order") return;
        const id = event.lastEventId;
        // Every order event carries an id; one without is never dropped.
        if (id !== "" && !seen.add(id)) return;
        const order = parseOrderEvent(event.data);
        if (order === null) return;
        invalidateOrders();
        handleOrderEvent(order, id);
      },
    });
    connectionRef.current = connection;
    connection.start();

    const onOnline = () => {
      connection.retryNow();
    };
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("online", onOnline);
      connection.stop();
      connectionRef.current = null;
      clearTimeout(invalidateTimer);
    };
  }, [userId, tokens, queryClient, seen]);

  const retryNow = useCallback(() => {
    connectionRef.current?.retryNow();
  }, []);

  return { status, retryNow };
};
