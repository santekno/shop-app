import { Outlet, ScrollRestoration } from "react-router";
import { useRouteFocus } from "./useRouteFocus.ts";

/**
 * The root route: no markup of its own, only what every page needs
 * whatever layout it uses. The focus moves to the new page's heading after
 * a navigation (useRouteFocus); a new page starts at the top, and Back
 * returns to where the user was (ScrollRestoration).
 */
export function AppRoot() {
  useRouteFocus();
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
