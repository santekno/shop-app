import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config as appConfig } from "@/config.ts";
import { analyticsId, imageOrigin } from "@/lib/server-config.ts";

/**
 * The Content-Security-Policy of every page (Bab 11 artikel 08), set here
 * instead of in Caddy. Next.js' proxy (called middleware before Next.js
 * 16) runs on the server before each matching request.
 *
 * Why a nonce: a server-rendered Next.js page carries inline <script>
 * elements (the data React needs to hydrate, `self.__next_f.push(…)`),
 * and Bab 10's `script-src 'self'` refuses inline code. 'unsafe-inline'
 * would let an injected script run as well, which is what the CSP is for.
 * A nonce is a random value made per request: the CSP allows inline
 * scripts carrying it, Next.js adds it to its own scripts by reading this
 * header, and an attacker who injects markup cannot guess it.
 *
 * The cost: a page cached once would carry one nonce for everybody, so
 * every page renders per request (no full-route cache). The data the
 * pages fetch is still cached (artikel 09).
 *
 * No 'strict-dynamic': with it, browsers ignore 'self', and the theme
 * script (public/theme.js) and the code chunks Next.js loads later would
 * each need the nonce too. 'self' plus a nonce is enough here.
 *
 * Google Analytics (artikel 13) adds Google's hosts only when
 * GA_MEASUREMENT_ID is set: a shop without analytics keeps the policy
 * exactly as it was.
 */
const contentSecurityPolicy = (nonce: string): string => {
  const dev = process.env.NODE_ENV === "development";
  const apiOrigin = new URL(appConfig.apiUrl).origin;
  // Product photos come from the image storage (artikel 12): its one
  // origin, from IMAGE_ORIGIN, never `https:` (any host).
  const images = imageOrigin();
  // GA4's hosts, the set Google documents for a CSP (developers.google.com/
  // tag-platform/security/guides/csp): gtag.js comes from
  // googletagmanager.com, its hits go to google-analytics.com and
  // analytics.google.com (a region's subdomain, hence the wildcards), and
  // a hit can fall back to an image request. Its own inline code carries
  // the nonce, so there is still no 'unsafe-inline'.
  const ga = analyticsId() !== undefined;
  const gaScript = ga ? " https://*.googletagmanager.com" : "";
  const gaImg = ga
    ? " https://*.google-analytics.com https://*.googletagmanager.com"
    : "";
  const gaConnect = ga
    ? " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com"
    : "";
  return [
    "default-src 'self'",
    // Development: React rebuilds server error stacks with eval().
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}${gaScript}`,
    // Development: hot reload injects <style> elements.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self' data:${images === undefined ? "" : ` ${images}`}${gaImg}`,
    // The browser calls the API, and nothing else but analytics when it
    // is on. (Payments add nothing: Midtrans' page is a top-level
    // navigation, Bab 11 artikel 04.)
    `connect-src 'self' ${apiOrigin}${gaConnect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};

export function proxy(request: NextRequest) {
  // A random UUID (122 random bits), base64: unguessable, new each time.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  // The request headers reach the page: Next.js reads the nonce from the
  // CSP header, the root layout from x-nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the hashed build files, the files in public/
      // (anything with a dot) or the health check.
      source: "/((?!_next/static|_next/image|healthz|.*\\.).*)",
      // A <Link> prefetch is not a page view; it gets its nonce when the
      // page is really rendered.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
