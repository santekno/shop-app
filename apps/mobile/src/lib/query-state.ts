// Which of the four things a screen can show a query is in: the data, a
// wait for the network, the error, or the first load. The same decision
// ProductList and the Kategori tab make by hand; the home screen has
// several queries side by side, so it is written once.
import type { UseQueryResult } from "@tanstack/react-query";

export type QueryView = "ready" | "offline" | "error" | "loading";

/**
 * `data` decides first: data on screen stays on screen, even while a
 * refetch runs or after one failed (the old copy beats a blank). With no
 * data yet: a paused query is waiting for the network (onlineManager,
 * src/lib/query-client.ts), a failed one shows its error, anything else is
 * the first load.
 */
export const queryView = (
  query: Pick<UseQueryResult, "data" | "status" | "fetchStatus" | "isFetching">,
): QueryView => {
  if (query.data !== undefined) return "ready";
  if (query.fetchStatus === "paused") return "offline";
  if (query.status === "error" && !query.isFetching) return "error";
  return "loading";
};
