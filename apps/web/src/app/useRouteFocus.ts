import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useLocation } from "react-router";

/**
 * Moves the keyboard focus when the page changes.
 *
 * A full page load puts a screen reader at the top of the new page. A
 * client-side navigation does not: the old link disappears from under
 * the focus, which falls back to <body>, and nothing is announced. So
 * after each navigation to another path the focus goes to the page's
 * <h1> (each page has one, with tabIndex={-1}); a screen reader reads
 * the new page's title, and Tab continues from there. A page without its
 * heading yet (still loading) gets <main> instead.
 *
 * Only the path counts: a filter in the query string (?kategori=…) keeps
 * the focus on the control the buyer is using. The first render is the
 * page load itself, where the browser already does the right thing.
 */
export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>) => {
  const { pathname } = useLocation();
  // The path focus was last handled for. A ref: changing it must not
  // render anything.
  const handled = useRef(pathname);

  useEffect(() => {
    if (handled.current === pathname) return;
    handled.current = pathname;
    const main = mainRef.current;
    if (main === null) return;
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    target.focus({ preventScroll: true });
  }, [pathname, mainRef]);
};
