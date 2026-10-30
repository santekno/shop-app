import { NavLink } from "react-router";
import { UnreadOrdersBadge } from "@/features/realtime/components/UnreadOrdersBadge.tsx";
import { ORDERS_PATH } from "@/features/realtime/order-events-context.ts";
import { cn } from "@/lib/utils.ts";
import { NAV_ITEMS } from "./navigation.ts";

/** The id the header's menu button points at (aria-controls). */
export const SIDEBAR_ID = "navigasi-utama";

interface SidebarProps {
  /**
   * Below `md` the sidebar is folded away until the header's "Menu" button
   * opens it; from `md` it is always there and this is ignored.
   */
  open: boolean;
  /** A link was followed: the layout folds the phone menu again. */
  onNavigate: () => void;
}

/**
 * The dashboard's main navigation: one <nav> landmark, named, so a screen
 * reader can jump to it and tell it from the breadcrumb.
 *
 * React Router's <NavLink> sets aria-current="page" on the link of the
 * page on screen; the classes style that attribute, so what a screen
 * reader hears and what the eye sees come from the same fact.
 *
 * On a phone it is a disclosure (a button that shows and hides it), not a
 * modal drawer: nothing traps the focus, and nothing locks the page's
 * scrolling, which in Radix's Dialog inserts a <style> element the CSP
 * refuses (the same reason DropdownMenu is non-modal).
 */
export function Sidebar({ open, onNavigate }: SidebarProps) {
  return (
    <nav
      id={SIDEBAR_ID}
      aria-label="Menu utama"
      className={cn(
        "border-b border-border bg-card md:block md:w-60 md:shrink-0 md:border-r md:border-b-0",
        open ? "block" : "hidden",
      )}
    >
      <ul className="grid gap-1 p-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
              {to === ORDERS_PATH && <UnreadOrdersBadge />}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
