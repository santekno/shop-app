import { useEffect, useRef } from "react";
import type { EcommerceEvent } from "@goshop/shared";
import { track } from "@/lib/analytics.ts";

/**
 * Sends `event` once per `key` while the component stays mounted: a view
 * of something the page shows (a list, a product, the checkout).
 *
 * A render is not a view. A component renders again for every state
 * change, a poll, a hover; an event sent from the render body would be
 * counted many times, and twice in development (Strict Mode renders
 * twice). An effect runs after the page is on screen, and the ref keeps
 * the last key sent, so the same list or product is sent once, and
 * another one (new filters, another slug) is sent again. Strict Mode's
 * extra mount in development keeps the ref, so it sends nothing twice.
 *
 * `event` is null until the page knows what it shows (the data has not
 * arrived): nothing is sent, and the key is not used up.
 *
 * @example
 *   useTrackOnce(product === undefined ? null : viewItemEvent(product), product?.id);
 */
export const useTrackOnce = (
  event: EcommerceEvent | null,
  key: string | undefined,
): void => {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (event === null || key === undefined || sent.current === key) return;
    sent.current = key;
    track(event);
  }, [event, key]);
};
