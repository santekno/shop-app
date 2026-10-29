"use client";

import {
  type DehydratedState,
  HydrationBoundary,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";

interface ServerDataBoundaryProps {
  /** dehydrate() of the server component's QueryClient. */
  state: DehydratedState;
  children: ReactNode;
}

/**
 * HydrationBoundary that hands the browser only the queries it does not
 * hold yet (Bab 11 artikel 09).
 *
 * A server page fetches its data on every request, also when the buyer
 * comes back to it with a <Link>, and HydrationBoundary writes data that
 * is newer than the browser's over the browser's copy. For the catalog
 * that is a loss: the server fetched page 1, the browser holds pages 1–3
 * the buyer scrolled through, and after hydration only page 1 is left,
 * the card the buyer came back to is gone, and so is the focus on it.
 *
 * So the server's data fills a gap and never replaces what the browser
 * already has. Whether the browser's copy is still fresh is the query's
 * own business (staleTime, as everywhere else): a stale one is shown and
 * refetched in the background, all of its pages.
 */
export function ServerDataBoundary({
  state,
  children,
}: ServerDataBoundaryProps) {
  const queryClient = useQueryClient();
  const missing = useMemo(
    () => ({
      ...state,
      queries: state.queries.filter(
        (query) => queryClient.getQueryData(query.queryKey) === undefined,
      ),
    }),
    [state, queryClient],
  );
  return <HydrationBoundary state={missing}>{children}</HydrationBoundary>;
}
