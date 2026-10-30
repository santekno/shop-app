import { useState } from "react";
import { Outlet } from "react-router";
import { OrderEventsProvider } from "@/features/realtime/components/OrderEventsProvider.tsx";
import { OrderToasts } from "@/features/realtime/components/OrderToasts.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { MAIN_ID } from "./useRouteFocus.ts";

/**
 * The dashboard: its frame, inside the live order events (artikel 09).
 * Only a seller or an admin ever renders it (RequireStaff), so the event
 * stream opens with it and closes with it, when the user logs out. The
 * toasts come after the frame: after the page for Tab, over it for the
 * eye (they are fixed in the corner).
 */
export function DashboardLayout() {
  return (
    <OrderEventsProvider>
      <DashboardFrame />
      <OrderToasts />
    </OrderEventsProvider>
  );
}

/**
 * The frame around every dashboard page, in reading order:
 *
 *   skip link → header (banner) → sidebar (navigation) → main
 *
 * The same order for the eye and for Tab: from `md` the sidebar sits to
 * the left of <main>, below that it folds under the header behind the
 * "Menu" button. Moving between pages re-renders only the <Outlet />.
 *
 * Only a seller or an admin ever sees this layout: RequireStaff, its
 * parent route, renders the login or the "no access" page instead.
 */
function DashboardFrame() {
  // The phone menu. Local state: only this layout and its two children
  // (the button and the sidebar) need it, so it is lifted no higher.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* First in the document, so it is the first stop for Tab. */}
      <SkipLink />
      <AppHeader
        menuOpen={menuOpen}
        onToggleMenu={() => {
          setMenuOpen((open) => !open);
        }}
      />
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar
          open={menuOpen}
          onNavigate={() => {
            setMenuOpen(false);
          }}
        />
        {/* tabIndex={-1}: code can give <main> the focus (the skip link,
            useRouteFocus), but Tab never stops on it, so no ring. */}
        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 focus:outline-none md:px-8"
        >
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
