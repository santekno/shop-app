import { useSyncExternalStore } from "react";
import { ANALYTICS_CONSENT_KEY } from "./gtag-init.ts";

/*
 * The buyer's answer to "Izinkan analytics?" (Bab 11 artikel 13), and
 * Google's Consent Mode v2 kept in step with it.
 *
 * Advanced consent mode: gtag.js loads for everyone. Before any answer,
 * and after "Tolak", `analytics_storage` is "denied": gtag.js writes no
 * cookie and sends cookieless pings (no client id), which GA4 can only
 * use for modelled totals. After "Izinkan" it is "granted": the _ga
 * cookie, and visits that join up into sessions and funnels. The three
 * ads signals are always "denied": GoShop runs no ads, and no event of
 * ours should ever reach an advertising product.
 *
 * The answer lives in localStorage under ANALYTICS_CONSENT_KEY
 * (gtag-init.ts), as "granted" or "denied". The root layout's inline
 * script reads it before gtag.js runs, so a returning buyer's choice is
 * the *default*, not an update that arrives after the first hit.
 */

export type AnalyticsConsent = "granted" | "denied";

const isConsent = (value: unknown): value is AnalyticsConsent =>
  value === "granted" || value === "denied";

/**
 * The stored answer, or null when the buyer has not answered (or storage
 * is blocked, which reads the same: ask, and do not remember).
 */
export const readAnalyticsConsent = (): AnalyticsConsent | null => {
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return isConsent(value) ? value : null;
  } catch {
    return null;
  }
};

/** Tells gtag.js the answer: only analytics_storage ever changes. */
const applyToGtag = (consent: AnalyticsConsent) => {
  try {
    window.gtag?.("consent", "update", { analytics_storage: consent });
  } catch {
    // Analytics never breaks the page.
  }
};

const listeners = new Set<() => void>();

/**
 * Applies and remembers the buyer's answer. Remembering can fail (blocked
 * storage, a full quota): the answer then holds until the page closes,
 * and the banner asks again on the next visit.
 */
export const setAnalyticsConsent = (consent: AnalyticsConsent): void => {
  applyToGtag(consent);
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
  } catch {
    // Not remembered; see above.
  }
  for (const onChange of listeners) onChange();
};

// Another tab answering changes this tab too: the browser sends every
// other tab of the origin a `storage` event for the key.
const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ANALYTICS_CONSENT_KEY) return;
    const consent = readAnalyticsConsent();
    if (consent !== null) applyToGtag(consent);
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * The server cannot read localStorage: it renders "not known yet"
 * (undefined), and so does the browser's first render while hydrating.
 * Right after, the real answer (or null, "not answered") is read and the
 * banner appears if it must. The HTML never contains the banner.
 */
const serverConsent = (): AnalyticsConsent | null | undefined => undefined;

/**
 * The stored answer: undefined while it cannot be known (the server, the
 * hydrating render), null when the buyer has not answered, or the answer.
 */
export const useAnalyticsConsent = (): AnalyticsConsent | null | undefined =>
  useSyncExternalStore(subscribe, readAnalyticsConsent, serverConsent);
