import { Navigate, Outlet, useLocation } from "react-router";
import { CenteredPage } from "@/app/CenteredPage.tsx";
import { LoadingState } from "@/components/ui/StatusMessage.tsx";
import { loginPathFor } from "../return-to.ts";
import { can } from "../permissions.ts";
import { useSession } from "../session-context.ts";
import { NoAccessPage } from "./NoAccessPage.tsx";

/**
 * The layout route around the whole dashboard. It adds no URL segment and
 * no markup of its own; it decides what may render:
 *
 * - "restoring": the start-up refresh has not answered yet. Deciding now
 *   would send a seller who reloads /produk to the login form, so it waits.
 * - "anonymous": to /masuk, with the page asked for in `kembali`, so the
 *   login can come back to it. `replace`: Back from the login form goes to
 *   the page before, not to a page that redirects again.
 * - a role without "dashboard:view" (a buyer): the "no access" page, at
 *   whatever URL was asked for. Never the dashboard layout: not one link
 *   of the sidebar, not one request.
 * - a seller or an admin: the dashboard (<Outlet />).
 *
 * This is about what the user sees, not about security: the API refuses
 * every /v1/admin request from a buyer (403) and without a token (401)
 * anyway. The role is read on every render, so when a refresh brings a
 * new one (a seller made a buyer), this page follows at once. What each
 * staff role may do inside the dashboard: permissions.ts (artikel 08).
 */
export function RequireStaff() {
  const { status, session } = useSession();
  const location = useLocation();

  if (status === "restoring") {
    return (
      <CenteredPage>
        <LoadingState>Memeriksa sesi Anda…</LoadingState>
      </CenteredPage>
    );
  }
  if (status === "anonymous") {
    const here = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPathFor(here)} replace />;
  }
  if (!can(session.user.role, "dashboard:view")) {
    return <NoAccessPage user={session.user} />;
  }
  return <Outlet />;
}
