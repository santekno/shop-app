import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { matchPath, useLocation } from "react-router";
import { PRODUCT_ROUTE } from "@/features/product/paths.ts";

/**
 * Moves the keyboard focus when the page changes.
 *
 * A full page load puts a screen reader at the top of the new page. A
 * client-side navigation does not: the old link disappears from under
 * the focus, which falls back to <body>, and nothing is announced. So
 * after each navigation to another path:
 *
 * 1. Back from a product to a list that shows it: the product's card
 *    link, as Bab 8's App did with its returnFocusTo ref. focus() also
 *    scrolls the card into view, near where the buyer was.
 * 2. Otherwise the page's <h1> (each page has one, with tabIndex={-1}):
 *    a screen reader reads the new page's title, and Tab continues from
 *    there.
 * 3. A page without its heading yet (still loading) gets <main>.
 *
 * Only the path counts: a filter in the query string (?kategori=…) keeps
 * the focus on the control the buyer is using. The first render is the
 * page load itself, where the browser already does the right thing.
 */
export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>) => {
  const { pathname } = useLocation();
  // The path focus was last handled for: the page the buyer comes from.
  // A ref, because changing it must not render anything.
  const handled = useRef(pathname);

  useEffect(() => {
    const from = handled.current;
    if (from === pathname) return;
    handled.current = pathname;
    const main = mainRef.current;
    if (main === null) return;

    // matchPath decodes the parameter, so it compares equal to the slug
    // the card was rendered with. CSS.escape makes any slug safe inside
    // the selector's quotes.
    const slug = matchPath(PRODUCT_ROUTE, from)?.params.slug;
    const card =
      slug === undefined
        ? null
        : main.querySelector<HTMLElement>(
            `[data-product-slug="${CSS.escape(slug)}"]`,
          );
    if (card !== null) {
      card.focus();
      return;
    }
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    target.focus({ preventScroll: true });
  }, [pathname, mainRef]);
};
