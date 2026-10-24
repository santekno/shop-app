import { useEffect, useEffectEvent, useRef } from "react";

interface OnVisibleOptions {
  /** Watch only while true. */
  enabled: boolean;
  /** How far outside the screen counts as visible already. Default "300px". */
  rootMargin?: string;
}

/**
 * Calls `onVisible` when the element given the returned ref scrolls into
 * view (or near it, `rootMargin`): the sentinel of an infinite list.
 *
 * IntersectionObserver lets the browser report visibility, instead of
 * measuring positions on every scroll event. A new observer reports at
 * once whether the element is visible, so turning `enabled` off and on
 * again (while a page loads, and after it) checks again: a page too
 * short to push the sentinel off screen loads the next one too.
 *
 * useEffectEvent: the effect always calls the latest `onVisible`, but
 * does not restart (and recreate the observer) when it changes.
 */
export const useOnVisible = <T extends Element>(
  onVisible: () => void,
  { enabled, rootMargin = "300px" }: OnVisibleOptions,
) => {
  const ref = useRef<T>(null);
  const handleVisible = useEffectEvent(onVisible);

  useEffect(() => {
    const element = ref.current;
    // Without IntersectionObserver (very old browsers, some test
    // environments) nothing loads by itself: the button still works.
    if (!enabled || element === null) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) handleVisible();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [enabled, rootMargin]);

  return ref;
};
