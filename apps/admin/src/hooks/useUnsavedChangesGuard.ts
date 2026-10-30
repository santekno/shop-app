import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "react-router";
import type { BlockerFunction } from "react-router";

/**
 * Keeps unsaved changes from being lost by leaving the page, while `dirty`
 * is true. Two different exits, two mechanisms:
 *
 * - **Inside the app** (a sidebar link, the breadcrumb, Back): React
 *   Router's `useBlocker` holds the navigation. The returned `blocker` is
 *   then in state "blocked", and the page asks the user (a dialog):
 *   `blocker.proceed()` leaves, `blocker.reset()` stays. Only a change of
 *   path counts; a search parameter on the same page is not leaving.
 * - **Out of the app** (closing the tab, a reload, typing another
 *   address): the browser's `beforeunload` event. A page can only ask the
 *   browser to show its own generic "Leave site?" prompt (preventDefault);
 *   the text cannot be chosen. The listener exists only while there is
 *   something to lose: an unconditional one would keep the browser from
 *   putting the page in its back/forward cache.
 *
 * `allowNavigation()` lets the next navigation through without asking:
 * after a save, the form's values are still "dirty" until the next render,
 * but nothing would be lost.
 */
export const useUnsavedChangesGuard = (dirty: boolean) => {
  const allowed = useRef(false);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowed.current &&
      currentLocation.pathname !== nextLocation.pathname,
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  const allowNavigation = useCallback(() => {
    allowed.current = true;
  }, []);

  return { blocker, allowNavigation };
};
