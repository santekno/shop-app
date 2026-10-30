import { createContext, useContext } from "react";
import type { ConnectionStatus } from "./connection.ts";
import type { OrderToast } from "./toasts.ts";

/** The dashboard's path for orders, and every page under it. */
export const ORDERS_PATH = "/pesanan";

export const isOrdersPath = (pathname: string): boolean =>
  pathname === ORDERS_PATH || pathname.startsWith(`${ORDERS_PATH}/`);

/** What OrderEventsProvider shares with the header, sidebar and toasts. */
export interface OrderEventsValue {
  status: ConnectionStatus;
  /** Ends a reconnect wait now ("Coba lagi"). */
  retryNow: () => void;
  /** New paid orders since the orders page was last open. */
  unread: number;
  toasts: readonly OrderToast[];
  /** The newest toast's text, for the live region. */
  announcement: string;
  dismissToast: (id: string) => void;
}

export const OrderEventsContext = createContext<OrderEventsValue | null>(null);

/** The live order events, from the nearest <OrderEventsProvider>. */
export const useOrderEventsContext = (): OrderEventsValue => {
  const value = useContext(OrderEventsContext);
  if (value === null) {
    throw new Error(
      "useOrderEventsContext must be used inside <OrderEventsProvider>",
    );
  }
  return value;
};
