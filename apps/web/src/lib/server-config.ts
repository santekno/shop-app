import "server-only";
import { config } from "@/config.ts";

/**
 * Settings only the storefront's server reads, from its environment when
 * it runs (not at build time): one image can run against any API.
 *
 * `import "server-only"` makes the build fail if a client component ever
 * imports this file, so a server-only value can never be bundled into
 * the browser's JavaScript by accident.
 */
const internalApiUrl = process.env.API_INTERNAL_URL;

export const serverConfig = {
  /**
   * The API as this server reaches it: inside Docker Compose or a private
   * network that is another address than the browser's (http://api:8080).
   * Unset means the public URL.
   */
  apiUrl:
    internalApiUrl !== undefined && internalApiUrl !== ""
      ? internalApiUrl
      : config.apiUrl,
} as const;

/** The storefront's own origin when SITE_URL is not set, in development. */
const DEV_SITE_URL = "http://localhost:5173";

/**
 * The storefront's public origin (SITE_URL, Bab 11 artikel 10), for every
 * absolute URL the pages print: the canonical link, og:url, og:image, the
 * structured data, the sitemap. Read from the configuration, never from
 * the request's Host header, which the client chooses: a page must not
 * name an attacker's host as its canonical address.
 *
 * Unset is a configuration error in production: the page fails (500, and
 * the log says why) rather than telling search engines the shop lives at
 * localhost. Read when a page renders, not when the module loads, so
 * `next build` runs without it.
 */
export const siteUrl = (): URL => {
  const value = process.env.SITE_URL;
  if (value !== undefined && value !== "") return new URL(value);
  if (process.env.NODE_ENV !== "production") return new URL(DEV_SITE_URL);
  throw new Error(
    "SITE_URL is not set: the storefront's public origin, such as https://shop.example.com",
  );
};
