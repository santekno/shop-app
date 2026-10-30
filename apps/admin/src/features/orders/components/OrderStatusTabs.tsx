import { Link } from "react-router";
import type { OrderStatus } from "@goshop/shared";
import { cn } from "@/lib/utils.ts";
import { ORDER_STATUS_OPTIONS, queueHref } from "../order-status.ts";

/**
 * One link per status, the queue on screen marked with
 * aria-current="page". Links, not ARIA tabs (role="tablist"): each status
 * is its own address (/pesanan?status=dikirim) that can be bookmarked,
 * opened in a new tab, or reached with Back, and that is what a link is.
 * ARIA tabs would promise arrow-key navigation between panels of one
 * page, which this is not. A click changes only the query string, so
 * useRouteFocus leaves the focus on the link (artikel 01).
 *
 * The links wrap onto a second line on a phone instead of scrolling
 * sideways: every status stays visible.
 */
export function OrderStatusTabs({ current }: { current: OrderStatus }) {
  return (
    <nav aria-label="Status pesanan" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {ORDER_STATUS_OPTIONS.map((option) => {
          const active = option.value === current;
          return (
            <li key={option.value}>
              <Link
                to={queueHref(option.value)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium text-foreground no-underline hover:bg-accent",
                  "aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground",
                )}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
