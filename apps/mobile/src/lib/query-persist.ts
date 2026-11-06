// The query cache on disk (artikel 10): what the catalog fetched last time
// is there the moment the app opens, before any request, and when the
// phone has no network at all. Stale data on screen with a refetch behind
// it (staleTime, src/lib/query-client.ts) beats a skeleton.
//
// SECURITY, the rule of this file: AsyncStorage is plain, unencrypted
// storage that any backup or rooted device can read. So
//
//   - only public catalog data goes in (the allow-list below), and
//   - tokens never go in. Not in this cache and not anywhere in
//     AsyncStorage: when sign-in is built (a later chapter) the access and
//     refresh tokens go to expo-secure-store (Keychain / Keystore) only.
//
// The filter is an ALLOW-list on purpose: a new query key is not persisted
// until someone adds it here and reads this comment. A deny-list ("not
// me, not wishlist, not cart") would persist the next user-specific query
// by default.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query } from "@tanstack/react-query";
import type { PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import Constants from "expo-constants";

/**
 * How long a saved cache is trusted: a day. Older, the whole cache is
 * dropped on start-up instead of shown. TanStack Query requires every
 * persisted query's gcTime to be at least this (query-client.ts says 24 h),
 * or the entry is collected from memory before it could be saved.
 */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;

/** Writes to disk at most once per this long, not on every cache change. */
export const PERSIST_THROTTLE_MS = 2_000;

/** The AsyncStorage key the whole cache is saved under. */
export const PERSIST_STORAGE_KEY = "goshop.query-cache";

/**
 * Tied to the app's version: a new release may change the shape of a
 * response or of a cached key, and an old cache read by new code is a crash
 * or a wrong screen. A different buster throws the saved cache away.
 * (A schema change inside one version bumps the version too.)
 */
export const PERSIST_BUSTER: string = Constants.expoConfig?.version ?? "0";

/**
 * Which queries are saved. The first key part decides:
 *
 *   ["categories"]                   yes
 *   ["banners"]                      yes
 *   ["products", "list", {...}]      yes, except a search (`q` set): a
 *                                    typed query is noise, not a catalog
 *   ["products", "featured"]         yes
 *   ["products", "detail", slug]     yes
 *   anything else (me, wishlist, cart, orders, ...)   NO
 *
 * Only a query that succeeded: a pending one has no data, and an error is
 * not worth keeping.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [scope, kind, detail] = query.queryKey;
  if (scope === "categories" || scope === "banners") return true;
  if (scope !== "products") return false;
  if (kind === "featured" || kind === "detail") return true;
  if (kind === "list") {
    const q = (detail as { q?: unknown } | undefined)?.q;
    return q === undefined || q === "";
  }
  return false;
}

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSIST_STORAGE_KEY,
  throttleTime: PERSIST_THROTTLE_MS,
});

/**
 * The `persistOptions` of <PersistQueryClientProvider>. Mutations are never
 * saved (`shouldDehydrateMutation: false`): their variables are what the
 * user typed, a login form's password among them, and a paused POST must
 * not be replayed by a later launch that has forgotten why it was sent.
 */
export const persistOptions: PersistQueryClientProviderProps["persistOptions"] =
  {
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster: PERSIST_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
      shouldDehydrateMutation: () => false,
    },
  };
