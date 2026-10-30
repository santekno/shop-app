import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * The id of every page's <main>: where the skip link goes and where
 * useRouteFocus looks for the page's heading. One id for all layouts (the
 * dashboard, the login page, the "no access" page), because only one of
 * them is on screen at a time.
 */
export const MAIN_ID = "konten";

/**
 * Gives the page's <h1> the focus, when what was under the focus is about
 * to disappear: a "Coba lagi" whose error turns into "Memuat…", or a form
 * that started over. Without it the focus falls to <body>, and a keyboard
 * or screen reader user is sent back to the top of the document. Call it
 * before the change: the heading stays, so the focus has somewhere to be.
 */
export const focusPageHeading = () => {
  document
    .getElementById(MAIN_ID)
    ?.querySelector<HTMLElement>("h1")
    ?.focus({ preventScroll: true });
};

/**
 * Moves the keyboard focus to the new page's <h1> after each navigation to
 * another path, or to <main> while the page has no heading yet.
 *
 * A full page load puts a screen reader at the top of the new page. A
 * client-side navigation does not: the link that was clicked may disappear
 * (the login button, a menu item), the focus falls back to <body>, and
 * nothing is announced. Focusing the heading reads the new page's title,
 * and Tab continues from there.
 *
 * The storefront's hook (Bab 9), called once in the root route instead of
 * in a layout: the dashboard has three layouts (login, "no access", the
 * dashboard itself), and a login switches from one to another. A hook
 * inside the dashboard layout would mount with the new path and see no
 * navigation at all. So it finds <main> by its id, after the new layout
 * has rendered (a parent's effect runs after its children's).
 *
 * Only the path counts: a search parameter (artikel 02's filters) keeps
 * the focus on the control being used. The first render is the page load
 * itself, where the browser already does the right thing.
 */
export const useRouteFocus = () => {
  const { pathname } = useLocation();
  // The path focus was last handled for. A ref: changing it renders nothing.
  const handled = useRef(pathname);

  useEffect(() => {
    if (handled.current === pathname) return;
    handled.current = pathname;
    const main = document.getElementById(MAIN_ID);
    if (main === null) return;
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    target.focus({ preventScroll: true });
  }, [pathname]);
};
