import { useRef } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { NavigationProgress } from "./NavigationProgress.tsx";
import { SiteHeader } from "./SiteHeader.tsx";
import { useRouteFocus } from "./useRouteFocus.ts";

/**
 * The frame around every page: the header, then the matched child route
 * in <Outlet />. Moving between pages re-renders only the outlet; the
 * header stays mounted.
 */
export function RootLayout() {
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);

  return (
    <>
      <NavigationProgress />
      <SiteHeader />
      {/* tabIndex={-1}: the page can give <main> the focus from code
          (useRouteFocus), but Tab never stops on it. */}
      {/* Utility classes instead of a .site-main rule: the width, the
          centring and the padding are read right here. focus:outline-none
          because <main> only takes the focus from code (no ring needed). */}
      <main
        ref={mainRef}
        className="mx-auto max-w-6xl px-4 pt-6 pb-12 focus:outline-none"
        tabIndex={-1}
      >
        <Outlet />
      </main>
      {/* A new page starts at the top; Back and Forward return to where
          the buyer was. Renders nothing itself. */}
      <ScrollRestoration />
    </>
  );
}
