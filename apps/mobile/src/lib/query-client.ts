// The app's TanStack Query cache, and the two things a browser tells
// TanStack Query by itself that a phone has to be asked for: whether the
// app is in front of the user (focus) and whether there is a network
// (online).
import {
  focusManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";

/**
 * How long fetched data counts as fresh, as on the web
 * (apps/web/src/lib/query-client.ts): a component that asks for fresh data
 * gets the cached copy and no request; after that it still gets the copy
 * at once, and a refetch runs in the background.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * The cache of server state, shared by every screen under
 * <QueryClientProvider> (app/_layout.tsx). The same defaults as the web:
 *
 * - `retry: false`: the API client (src/lib/api.ts) already retries a GET
 *   once when retrying can help (network failure, timeout, 502/503/504).
 *   TanStack's own three retries on top would turn one failed screen into
 *   up to eight requests and over a minute of spinner before the error.
 * - `staleTime`, above, instead of TanStack's 0.
 *
 * Kept as they are: `refetchOnWindowFocus` and `refetchOnReconnect` (both
 * driven by the managers below), `gcTime` (5 minutes) and `networkMode`
 * "online": while the phone has no network, a query waits (fetchStatus
 * "paused") instead of failing, and runs when the network is back.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: DEFAULT_STALE_TIME_MS,
    },
  },
});

/**
 * Focus. In a browser TanStack Query listens to `visibilitychange`; React
 * Native has no document, so it would never see the user come back. Here
 * "focused" is AppState "active": the app is on screen and in front.
 * Coming back from another app (or from the lock screen) refetches stale
 * queries, which is what "refetchOnWindowFocus" means on a phone.
 * "background" and "inactive" (iOS, during the app switcher or a call
 * banner) both count as not focused.
 */
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener("change", (state) => {
    setFocused(state === "active");
  });
  return () => {
    subscription.remove();
  };
});

/**
 * Online. A browser fires `online` and `offline`; React Native does not,
 * so expo-network reports the connection instead. `isConnected`, not
 * `isInternetReachable`: the API can be on the local network (10.0.2.2 on
 * the emulator, a laptop on the same Wi-Fi), where Android may report
 * "connected, internet not validated". Only a phone with no network at all
 * pauses its queries. A state that does not say counts as online, as
 * TanStack Query assumes before the first event.
 */
onlineManager.setEventListener((setOnline) => {
  // Set by the first change the listener reports; the start-up answer
  // below is older than that change, so it must not overwrite it.
  let changed = false;
  const subscription = addNetworkStateListener((state) => {
    changed = true;
    setOnline(state.isConnected !== false);
  });
  // The listener reports changes only. A phone that is already offline
  // when the app starts sends none, so TanStack Query would assume online:
  // the first page failed with "Tidak dapat terhubung" instead of waiting,
  // and nothing reloaded it when the network came back (no offline →
  // online change for onlineManager to see). Ask once for the state at
  // start-up. Found in the chapter's native check, airplane mode on before
  // the app was opened. If the question fails, TanStack Query keeps its
  // own assumption (online) and the listener corrects it on the next
  // change; a rejection must not go unhandled on the start-up path.
  getNetworkStateAsync()
    .then((state) => {
      if (!changed) {
        setOnline(state.isConnected !== false);
      }
    })
    .catch(() => {
      // Nothing to do: see above.
    });
  return () => {
    subscription.remove();
  };
});
