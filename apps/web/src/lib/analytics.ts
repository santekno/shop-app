import type { EcommerceEvent } from "@goshop/shared";

/*
 * What Google's tag adds to the page (Bab 11 artikel 13). Both exist only
 * when GA_MEASUREMENT_ID is set: the root layout's inline script defines
 * them before any React code runs (features/analytics/gtag-init.ts).
 * `declare global` adds them to TypeScript's Window type, as optional.
 */
declare global {
  interface Window {
    /** gtag.js' queue: every gtag() call is pushed here first. */
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Whether Google's tag is on this page (GA_MEASUREMENT_ID is set). */
export const analyticsEnabled = (): boolean =>
  typeof window !== "undefined" && typeof window.gtag === "function";

/**
 * Sends one e-commerce event to Google Analytics 4.
 *
 * - On the server it does nothing: an event is something a buyer's
 *   browser saw or did.
 * - Without GA_MEASUREMENT_ID there is no `gtag`, and the event goes
 *   nowhere; in development it is still logged (`console.debug`), so the
 *   events can be checked without a GA4 property.
 * - `gtag` is the inline script's stub until gtag.js has loaded: it
 *   pushes onto `dataLayer`, and gtag.js sends the queue, in order, when
 *   it arrives. An event fired during hydration is therefore not lost.
 * - It never throws. Analytics is the one feature a buyer never asked
 *   for; a bug in it must not break "Tambah ke keranjang" or the payment.
 *
 * Whether the hit carries a cookie is Consent Mode's business, not this
 * function's: with analytics declined, gtag.js sends cookieless pings
 * (features/analytics/consent.ts).
 */
export const track = (event: EcommerceEvent): void => {
  if (typeof window === "undefined") return;
  try {
    if (process.env.NODE_ENV === "development") {
      console.debug("[analytics]", event.name, event.params);
    }
    window.gtag?.("event", event.name, event.params);
  } catch {
    // Analytics never breaks the page.
  }
};
