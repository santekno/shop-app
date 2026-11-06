// "Terakhir dilihat": the products the buyer opened, kept on the phone.
// Client-only: no API, no account. A Zustand store persisted to
// AsyncStorage.
//
// SECURITY: AsyncStorage is plain text. Only a product's slug, name, a
// photo URL and a price snapshot go in (recent-state.ts). No token, no
// user id, no search text. Tokens are for expo-secure-store only (Bab 15).
//
// Why Zustand and not the TanStack Query cache: this is state the app
// owns (a list it writes), not a copy of the server's. The query cache
// is persisted by an allow-list of public queries (query-persist.ts) and
// this feature adds nothing to it.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addRecent,
  MAX_RECENT,
  readRecentItems,
  type RecentItem,
} from "./recent-state";

/** The AsyncStorage key. Versioned: a changed shape becomes `v2`. */
export const RECENT_STORAGE_KEY = "goshop.recent.v1";

interface RecentState {
  /** Newest first, at most MAX_RECENT. */
  items: readonly RecentItem[];
  /**
   * False until AsyncStorage has been read (or failed to be). The home
   * section draws nothing before that: an empty list would flash and
   * then jump to the real one.
   */
  hydrated: boolean;
  record: (item: RecentItem) => void;
  clear: () => void;
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      items: [],
      hydrated: false,
      record: (item) => {
        set((state) => {
          const items = addRecent(state.items, item);
          return items === state.items ? state : { items };
        });
      },
      clear: () => {
        set({ items: [] });
      },
    }),
    {
      name: RECENT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      // Only the list is written; `hydrated` and the actions are not data.
      partialize: (state) => ({ items: state.items }),
      // The stored list is checked, and merged with what was recorded
      // while the read was still running (a cold start straight onto a
      // product): that product stays first, nothing is overwritten.
      merge: (persisted, current) => {
        const stored = readRecentItems(
          (persisted as { items?: unknown } | undefined)?.items,
        );
        const seen = new Set(current.items.map((item) => item.slug));
        const items = [
          ...current.items,
          ...stored.filter((item) => !seen.has(item.slug)),
        ].slice(0, MAX_RECENT);
        return { ...current, items };
      },
      // Also runs when the read failed: a storage error must not hide
      // the section forever, it just starts empty.
      onRehydrateStorage: () => () => {
        useRecentStore.setState({ hydrated: true });
      },
    },
  ),
);
