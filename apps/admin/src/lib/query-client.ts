import { QueryClient } from "@tanstack/react-query";

/**
 * How long fetched data counts as fresh. Shorter than the storefront's
 * 30 seconds: a seller works on orders and stock that change under their
 * hands (a buyer pays, another admin ships), and a dashboard that shows
 * a minute-old queue sends them after work that is already done.
 * Artikel 09 adds realtime events, which refetch the order queries the
 * moment something happens; this is the floor without them.
 */
export const DEFAULT_STALE_TIME_MS = 10_000;

/**
 * Creates the QueryClient, the cache of server state, with the storefront's
 * defaults (Bab 9, `git show bab-10:apps/web/src/lib/query-client.ts`):
 *
 * - `retry: false`: our API client (lib/api.ts) already retries a GET when
 *   retrying can help (the network, a timeout, 502/503/504). TanStack's own
 *   3 retries on top would turn one failure into up to 12 requests, and
 *   would also retry errors that never pass by themselves (403, 404, 400).
 * - `staleTime`, above.
 *
 * A function, not only a module-level value, so a test can give each test
 * a client of its own, with an empty cache.
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

/** The dashboard's one QueryClient. */
export const queryClient = createQueryClient();
