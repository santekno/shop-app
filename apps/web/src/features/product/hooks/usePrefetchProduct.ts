import { useRef } from "react";
import type { PointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { productQuery } from "../api/queries.ts";
import { loadProductPage } from "../lazy.ts";

/** How long the mouse must rest on a card before it counts as interest:
 *  sweeping across the grid on the way somewhere else prefetches nothing. */
const HOVER_DELAY_MS = 100;

/**
 * Event handlers for a link to a product page that start loading the page
 * before the click: its data (GET /v1/products/{slug}, into the cache the
 * page reads) and its code (the lazy route's chunk). Between hover and
 * click there are usually a few hundred milliseconds; by the click, the
 * page is often ready to show at once, heading and all.
 *
 * - Mouse: after resting HOVER_DELAY_MS on the link.
 * - Keyboard: on focus, since Tab to a link often precedes Enter.
 * - Touch: no hover prefetch. A tap sends pointerenter right before the
 *   click, so a hover timer gains nothing (and on a phone each needless
 *   request costs data). `pointerType` tells them apart, where a
 *   "(hover: hover)" media query would also skip a laptop's touch screen
 *   used with a mouse.
 *
 * Focus is not only the keyboard's: in Chromium, pressing a link with the
 * mouse (on mouse-down) or tapping it on a phone focuses it too, so onFocus
 * also prefetches then, a few milliseconds before the click navigates.
 * Safari and Firefox on macOS do not focus a link on click, nor iOS Safari
 * on tap; there the click alone loads the page. That costs no extra request: they are the requests the
 * click makes anyway, and the page reuses them (the query is already in
 * the cache or in flight under the same key, and import() returns the
 * module it is already loading). It gains little, and needs no special
 * case.
 *
 * queryClient.query fetches into the cache unless the cached copy is
 * still fresh: a product fetched less than 30 seconds ago is not fetched
 * again. (It is the newer name for prefetchQuery, which many tutorials
 * still show and TanStack Query 5.10x marks deprecated; the lint rule
 * @typescript-eslint/no-deprecated points it out.) Unlike prefetchQuery it
 * rejects on an error, so the error is swallowed here: a failed prefetch
 * leaves the cache as it was, and the page loads normally on the click.
 */
export const usePrefetchProduct = (slug: string) => {
  const queryClient = useQueryClient();
  // The pending hover timer. No cleanup on unmount: a timer that fires
  // after the card is gone only warms the cache, which is harmless.
  const timer = useRef<number | undefined>(undefined);

  const prefetch = () => {
    queryClient.query(productQuery(slug)).catch(() => undefined);
    // The chunk is fetched once; a failure here is retried by the click.
    loadProductPage().catch(() => undefined);
  };

  const cancel = () => {
    window.clearTimeout(timer.current);
  };

  return {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "mouse") return;
      cancel();
      timer.current = window.setTimeout(prefetch, HOVER_DELAY_MS);
    },
    onPointerLeave: cancel,
    onFocus: prefetch,
  };
};
