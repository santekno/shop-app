import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useIsOnline } from "./useIsOnline";

/** What the banner shows: nothing, "offline", or "back online" for a moment. */
export type ConnectionBannerState = "hidden" | "offline" | "restored";

/** How long "Kembali online" stays before the banner slides away. */
export const RESTORED_VISIBLE_MS = 3_000;

/**
 * Refetches what is on screen and out of date once the network is back.
 *
 * TanStack Query already does most of this by itself: onlineManager
 * resumes the paused queries, and refetchOnReconnect refetches the stale
 * ones. This is the explicit version for the buyer's benefit: only queries
 * a mounted screen uses (`type: "active"`), only the stale ones (a list
 * fetched 5 s before the signal dropped needs nothing), and
 * `cancelRefetch: false` so it joins a request that the library has
 * already started instead of cancelling and restarting it.
 */
export const refetchAfterReconnect = (client: QueryClient) =>
  client.refetchQueries(
    { type: "active", stale: true },
    { cancelRefetch: false },
  );

/**
 * The banner's state, from the network alone:
 *
 *   online  --(goes offline)-->  offline
 *   offline --(comes back)---->  restored  --(3 s)-->  hidden
 *
 * "offline" is simply `!online`. "restored" is a flag raised when the
 * network changes from offline to online and dropped by a timer. The flag
 * is set while rendering, not in an effect: React allows a component to
 * adjust its own state in response to a changed value during render
 * ("storing information from previous renders"), and it avoids the extra
 * render an effect would cause. The effect below only does the side
 * effects: refetch and the timer. Going offline again within the three
 * seconds clears the flag, and the effect's cleanup cancels the timer.
 *
 * A phone that starts online never shows "restored": the flag starts
 * false and only a change of `online` can raise it.
 */
export function useConnectionBanner(
  restoredMs: number = RESTORED_VISIBLE_MS,
): ConnectionBannerState {
  const online = useIsOnline();
  const client = useQueryClient();
  const [previousOnline, setPreviousOnline] = useState(online);
  const [restored, setRestored] = useState(false);

  if (online !== previousOnline) {
    setPreviousOnline(online);
    setRestored(online);
  }

  useEffect(() => {
    if (!restored) return;
    void refetchAfterReconnect(client);
    const timer = setTimeout(() => {
      setRestored(false);
    }, restoredMs);
    return () => {
      clearTimeout(timer);
    };
  }, [restored, client, restoredMs]);

  if (!online) return "offline";
  return restored ? "restored" : "hidden";
}
