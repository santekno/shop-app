import { purchaseEvent } from "@goshop/shared";
import type { AnalyticsOrder } from "@goshop/shared";
import { analyticsEnabled, track } from "@/lib/analytics.ts";

/** Where the codes of the orders already reported are kept. */
export const TRACKED_PURCHASES_KEY = "goshop:analytics-purchases";

/**
 * How many codes are kept. A buyer pays a handful of orders; the list only
 * has to outlive the few reloads and returns of one order's payment, and
 * a cap keeps it from growing for ever.
 */
export const TRACKED_PURCHASES_LIMIT = 20;

/** This page's own memory, for when localStorage is blocked. */
const trackedThisPage = new Set<string>();

const readTracked = (): string[] => {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(TRACKED_PURCHASES_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((code): code is string => typeof code === "string")
      : [];
  } catch {
    return [];
  }
};

const writeTracked = (codes: readonly string[]) => {
  try {
    window.localStorage.setItem(
      TRACKED_PURCHASES_KEY,
      JSON.stringify(codes.slice(-TRACKED_PURCHASES_LIMIT)),
    );
  } catch {
    // Not remembered across reloads; trackedThisPage still holds it.
  }
};

/**
 * Sends `purchase` for a paid order, once per order in this browser.
 *
 * The payment page reports it when it sees the order paid, and a buyer
 * can see that many times: a reload, Back from Midtrans, the page opened
 * again from the order history. GA4's own de-duplication by
 * transaction_id is limited and not something a report should rest on,
 * so the codes already sent are kept in localStorage, the last
 * TRACKED_PURCHASES_LIMIT of them. Blocked storage means this page's
 * memory only: a reload could send it again, the lesser harm than never
 * sending it.
 *
 * The known gap: a buyer who pays and never comes back to the payment
 * page (closes the tab at Midtrans) is never counted. The reliable answer
 * is a server-side purchase, sent with GA4's Measurement Protocol by the
 * API when the payment webhook marks the order paid; GoShop does not
 * build it (docs/web/README.md, artikel 13).
 *
 * Without GA_MEASUREMENT_ID nothing is remembered: there is nobody to
 * count for, and `track` only logs in development.
 */
export const trackPurchaseOnce = (order: AnalyticsOrder): void => {
  if (!analyticsEnabled()) {
    track(purchaseEvent(order));
    return;
  }
  const tracked = readTracked();
  if (trackedThisPage.has(order.code) || tracked.includes(order.code)) return;
  trackedThisPage.add(order.code);
  writeTracked([...tracked, order.code]);
  track(purchaseEvent(order));
};
