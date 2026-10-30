import { useCallback, useMemo, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { useOrderEvents } from "../hooks/useOrderEvents.ts";
import { isNewPaidOrder, newOrderMessage } from "../order-event.ts";
import { OrderEventsContext, isOrdersPath } from "../order-events-context.ts";
import type { OrderEventsValue } from "../order-events-context.ts";
import { initialToastState, toastReducer } from "../toasts.ts";

/**
 * Opens the tab's one event stream (useOrderEvents) and turns its events
 * into what the dashboard shows: a toast for each new paid order, the
 * unread count on the sidebar's "Pesanan", and the connection's status in
 * the header. It sits in DashboardLayout, so it exists exactly while a
 * seller or an admin is logged in: logging out unmounts it, which closes
 * the stream.
 *
 * Only `order.paid` makes a toast and counts as unread: that is the
 * moment an order needs the seller (a `created` order is not paid yet,
 * the other changes are the staff's own work). Every order event still
 * refreshes the order queries.
 *
 * The unread count is not raised while the orders page is open (the
 * queue refreshes in front of the seller), and goes back to 0 whenever
 * it is opened.
 */
export function OrderEventsProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const onOrdersPage = isOrdersPath(pathname);
  const [unread, setUnread] = useState(0);
  const [toastState, dispatch] = useReducer(toastReducer, initialToastState);

  // Opening the orders page clears the count. Adjusted during render when
  // the page changes (React's "storing information from previous renders"),
  // not in an effect, which would first paint the old count.
  const [wasOnOrdersPage, setWasOnOrdersPage] = useState(onOrdersPage);
  if (wasOnOrdersPage !== onOrdersPage) {
    setWasOnOrdersPage(onOrdersPage);
    if (onOrdersPage) setUnread(0);
  }

  const { status, retryNow } = useOrderEvents({
    onOrderEvent: (event, id) => {
      if (!isNewPaidOrder(event)) return;
      dispatch({ type: "add", toast: { id, message: newOrderMessage(event) } });
      if (!onOrdersPage) setUnread((count) => count + 1);
    },
  });

  const dismissToast = useCallback((id: string) => {
    dispatch({ type: "dismiss", id });
  }, []);

  const value = useMemo(
    (): OrderEventsValue => ({
      status,
      retryNow,
      unread,
      toasts: toastState.toasts,
      announcement: toastState.announcement,
      dismissToast,
    }),
    [status, retryNow, unread, toastState, dismissToast],
  );

  return <OrderEventsContext value={value}>{children}</OrderEventsContext>;
}
