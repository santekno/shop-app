import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

// TanStack Query's onlineManager is the app's one source of truth for
// "is there a network": src/lib/query-client.ts feeds it from expo-network
// (the start-up answer and every change), and it is what pauses and
// resumes queries. The banner reads the same value, so what the buyer is
// told and what the queries do can never disagree.
//
// useSyncExternalStore is React's hook for a store that lives outside
// React: it subscribes, reads the snapshot on every render, and re-renders
// when the snapshot changes. onlineManager.subscribe calls the listener
// with the new boolean, which this hook does not need.
const subscribe = (onChange: () => void) =>
  onlineManager.subscribe(() => {
    onChange();
  });

const getSnapshot = () => onlineManager.isOnline();

/** True while the phone has a network (isConnected, see query-client.ts). */
export const useIsOnline = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
