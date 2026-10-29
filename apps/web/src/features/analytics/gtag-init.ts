/*
 * Google's tag, as the root layout puts it on the page (Bab 11 artikel
 * 13). Plain functions with no React and no browser code, so the server
 * component that renders the layout can import them.
 */

/** Where the buyer's answer to the consent banner is kept (consent.ts). */
export const ANALYTICS_CONSENT_KEY = "goshop:analytics-consent";

/** gtag.js for one measurement ID. */
export const gtagScriptUrl = (measurementId: string): string =>
  `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;

/**
 * The inline script that starts Google's tag, Google's own snippet with
 * Consent Mode's default in front of it:
 *
 * 1. `dataLayer` and `gtag()`: a queue, usable at once. gtag.js reads it
 *    when it arrives and sends what was queued, in order. (It must push
 *    the `arguments` object itself, not an array: gtag.js tells commands
 *    from plain data that way.)
 * 2. `consent default`, before anything else: the ads signals denied,
 *    always; analytics_storage as the buyer answered before, or denied.
 *    The stored answer is read here, synchronously, so a buyer who said
 *    "Izinkan" yesterday is counted with a cookie from the first hit.
 * 3. `js` and `config`: the property, and with it GA4's page_view. Page
 *    views after a client-side navigation come from GA4's enhanced
 *    measurement ("page changes based on browser history events"), so the
 *    storefront sends none itself.
 *
 * It runs in <head> while the HTML is parsed, before React hydrates, so
 * the events a page fires during hydration (view_item_list, view_item)
 * always find `gtag` and the consent default in place. The measurement ID
 * was checked to be "G-" and letters or digits (analyticsId()), and is written
 * with JSON.stringify anyway: nothing in it can end the string.
 */
export const gtagInitScript = (measurementId: string): string =>
  [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.gtag=gtag;",
    "var analyticsConsent=null;",
    `try{analyticsConsent=localStorage.getItem(${JSON.stringify(ANALYTICS_CONSENT_KEY)});}catch(e){}`,
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',",
    "analytics_storage:analyticsConsent==='granted'?'granted':'denied'});",
    "gtag('js',new Date());",
    `gtag('config',${JSON.stringify(measurementId)});`,
  ].join("");
