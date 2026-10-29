import { useMemo, useSyncExternalStore } from "react";

/**
 * A little state handed from one page to the next (Bab 11 artikel 08).
 *
 * React Router let a navigation carry `state` on its history entry
 * (`navigate(to, { state })`, `location.state`). Next.js' router has no
 * such option: `history.state` holds its own data. The storefront used it
 * for four small things: the catalog card telling the product page it
 * came from the list, the register page passing the new email to the
 * login page, and the checkout passing "fake gateway" or "the payment
 * could not start" to the payment page.
 *
 * Here the state is kept in sessionStorage under the path it is meant
 * for. Like history state it survives a reload of that page and stays in
 * the tab; unlike it, it lasts only while that page is on screen: the
 * next navigation to any other path forgets it (forgetNavigationStateUnless,
 * called by SiteFrame), so opening /masuk again later does not say "your account
 * was created" a second time. Nothing secret goes in (no token, no
 * password): sessionStorage is readable by any script on the page. The one
 * personal value, the email just registered, is forgotten on the next
 * navigation.
 */
const STORAGE_KEY = "goshop:navigation-state";

interface Stored {
  path: string;
  state: unknown;
}

/** Storage can be blocked; that only loses the hint, never the page. */
const readStored = (): string | null => {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Keeps `state` for the next visit of `path` (a pathname, no query). */
export const setNavigationState = (path: string, state: unknown): void => {
  try {
    const stored: Stored = { path, state };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Not kept: the next page works without it.
  }
};

/** The state kept for `path`, read in an event handler. */
export const navigationStateFor = (path: string): unknown =>
  parseFor(readStored(), path);

const parseFor = (raw: string | null, path: string): unknown => {
  if (raw === null) return undefined;
  try {
    const stored = JSON.parse(raw) as Partial<Stored>;
    return stored.path === path ? stored.state : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Forgets the kept state once the buyer is on another path than the one
 * it was meant for. SiteFrame calls it after every navigation.
 */
export const forgetNavigationStateUnless = (path: string): void => {
  const raw = readStored();
  if (raw === null) return;
  try {
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.path === path) return;
  } catch {
    // Unreadable: forget it too.
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage holds nothing to forget.
  }
};

// Nothing announces a change: the state is written before the navigation
// that reads it, and read again by the next page's render.
const subscribe = () => () => undefined;

/**
 * The state kept for `path`, read during a render. The server has no
 * sessionStorage: it renders `undefined`, and the browser's first render
 * after hydration reads the real value (useSyncExternalStore's server
 * snapshot), so the two never disagree.
 */
export const useNavigationState = (path: string): unknown => {
  const raw = useSyncExternalStore(subscribe, readStored, () => null);
  return useMemo(() => parseFor(raw, path), [raw, path]);
};
