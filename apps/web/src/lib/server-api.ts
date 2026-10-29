import "server-only";
import { createApiClient } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";
import { serverConfig } from "./server-config.ts";

/**
 * How long the storefront's server keeps an API answer before it asks
 * again (Bab 11 artikel 09), in seconds. Incremental Static Regeneration
 * applied to the data: within the window, every visitor's page is built
 * from the cached answer and the API sees no request; the first request
 * after it still gets the cached answer at once while Next.js fetches a
 * fresh one in the background (stale-while-revalidate).
 *
 * - A product: its price and stock change, but a minute late is fine on a
 *   product page. The cart and checkout ask the API themselves, and the
 *   checkout preview decides the price and the stock, never this page.
 * - A page of products: the same minute.
 * - The categories: an admin adds one now and then; five minutes.
 */
export const REVALIDATE_SECONDS = {
  product: 60,
  productList: 60,
  categories: 300,
} as const;

interface ServerApiOptions {
  /** Seconds the answers stay in Next.js' data cache; `false`: forever. */
  revalidate: number | false;
  /** Names for revalidateTag(), to drop entries before their time. */
  tags?: string[];
}

/**
 * An API client for server components: the same client as the
 * browser's (packages/shared), pointed at the API's internal address
 * (API_INTERNAL_URL) and with a fetch that asks Next.js to cache each GET
 * answer in its data cache (`next: { revalidate, tags }`). The cache is
 * shared by every request this server handles, so only public data may
 * go through it: never a request with a buyer's token.
 *
 * One retry for a GET (the browser's client does two): a server render
 * that waits too long keeps the buyer staring at a blank tab.
 */
export const serverApi = ({ revalidate, tags }: ServerApiOptions): ApiClient =>
  createApiClient({
    baseUrl: serverConfig.apiUrl,
    timeoutMs: 5_000,
    retries: 1,
    fetch: (input, init) =>
      fetch(input, { ...init, next: { revalidate, tags } }),
  });
