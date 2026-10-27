import { Navigate, Outlet, useLocation } from "react-router";
import { LoadingState } from "@/components/ui/StatusMessage.tsx";
import { loginPathFor } from "../return-to.ts";
import { useSession } from "../session-context.ts";

/**
 * A layout route around the pages that need a login (/akun). It adds no
 * URL segment and no markup of its own; it only decides whether its
 * children may render.
 *
 * - "restoring": the start-up refresh has not answered yet. Deciding now
 *   would send a logged-in buyer who reloads /akun to the login form, so
 *   it waits.
 * - "anonymous": to /masuk, with the page asked for in `kembali`, so the
 *   login can come back to it. `replace`: Back from the login form goes
 *   to the page before, not to /akun, which would redirect again.
 * - "authenticated": the page.
 *
 * This is about what the buyer sees, not about security: the API refuses
 * every protected request without a valid token anyway. A redirect only
 * saves the buyer a page full of 401 errors.
 */
export function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();

  if (status === "restoring") {
    return <LoadingState>Memeriksa sesi Anda…</LoadingState>;
  }
  if (status === "anonymous") {
    const here = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPathFor(here)} replace />;
  }
  return <Outlet />;
}
