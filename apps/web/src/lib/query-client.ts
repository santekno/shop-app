import { QueryClient } from "@tanstack/react-query";

/**
 * How long fetched data counts as fresh. While it is fresh, a component
 * that asks for it gets the cached copy and no request is sent; after
 * that it still gets the cached copy at once, and a refetch runs in the
 * background (stale-while-revalidate). Half a minute suits a catalog:
 * prices and stock change, but not from one click to the next.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * Creates the QueryClient: the cache of server state, shared by every
 * component under <QueryClientProvider>.
 *
 * Server state is not like useState. It lives on the server, the screen
 * only holds a copy, and that copy can be out of date. The client keeps
 * one entry per query key (["products", "list", filters],
 * ["products", "detail", slug]), shares it between all components that
 * use the key, removes it some time after the last one unmounts
 * (`gcTime`, 5 minutes by default), and decides when to fetch again.
 *
 * Defaults that differ from TanStack Query's own:
 *
 * - `retry: false`. TanStack Query retries a failed query 3 times, with
 *   1, 2 and 4 seconds between attempts. Our API client (lib/api.ts)
 *   already retries a GET twice when retrying can help: the network
 *   failed, the attempt timed out, or a gateway answered 502/503/504. On
 *   top of that, every one of TanStack's 4 attempts would make 3 of ours:
 *   up to 12 requests, and about a minute of "Memuat…" against an API
 *   that is down, before the buyer sees the error. TanStack would also
 *   retry errors that never pass by themselves (404 NOT_FOUND, 400
 *   VALIDATION_FAILED). One layer retries, the one that knows which
 *   errors are worth it.
 * - `staleTime`, above. TanStack's default is 0: every new component
 *   that uses a query, and every return to the browser tab, fetches again.
 *
 * Kept as they are: `refetchOnWindowFocus` (coming back to the tab
 * refreshes stale data; fresh data is left alone), `gcTime`, and the
 * `networkMode` "online": while the browser reports no network, a query
 * waits (fetchStatus "paused") and runs when the connection is back.
 * Mutations are never retried by default, which is what we want: a
 * POST must not be sent twice.
 *
 * A function, not only a module-level value, so a test can give each
 * test a client of its own, with an empty cache.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: DEFAULT_STALE_TIME_MS,
      },
    },
  });

/** The browser's one QueryClient, created on first use. */
let browserQueryClient: QueryClient | undefined;

/**
 * The QueryClient for where this code runs (Bab 11 artikel 08).
 *
 * - **On the server**, a new client every time: one request, one cache.
 *   A module-level client would live as long as the server process and
 *   be shared by every visitor; buyer A's cart or orders could end up in
 *   the HTML sent to buyer B. Server components prefetch into their own
 *   client and hand the result to the browser with dehydrate().
 * - **In the browser**, one client for the whole visit, as in Bab 9–10:
 *   the cache must outlive a navigation, and the session's cleanup
 *   (Providers) must reach the same cache the pages read.
 */
export const getQueryClient = (): QueryClient => {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
};
