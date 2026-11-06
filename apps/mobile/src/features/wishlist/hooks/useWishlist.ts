import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { announce } from "@/lib/announce";
import { showNotice } from "@/lib/notice";
import { queryKeys } from "@/lib/query-keys";
import {
  addToWishlist,
  fetchWishlistPage,
  fetchWishlistSlugs,
  removeFromWishlist,
} from "../api/wishlist";
import { getAccessToken } from "../auth-seam";
import { SIGN_IN_MESSAGE, wishlistErrorMessage } from "../messages";
import { toggleMutationOptions } from "./toggle-options";

/**
 * Whether anybody is signed in, as far as the wishlist is concerned. Read
 * from the seam on each render; Bab 15 turns the seam into a store that
 * re-renders on sign-in, and nothing here changes.
 */
export const isSignedIn = (): boolean => getAccessToken() !== null;

/**
 * The saved slugs, newest first: GET /v1/me/wishlist paged through once and
 * reduced to slugs. User-specific, so NEVER persisted (query-persist.ts
 * saves the catalog keys only) and never shared: it is dropped on sign-out.
 * `enabled: false` while signed out: no request that could only answer 401.
 */
export const wishlistIdsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.wishlist.ids(),
    queryFn: ({ signal }) => fetchWishlistSlugs(signal),
    enabled,
  });

/** The wishlist screen's pages, 20 products each. */
export const wishlistListQuery = (enabled: boolean) =>
  infiniteQueryOptions({
    queryKey: queryKeys.wishlist.list(),
    queryFn: ({ pageParam, signal }) => fetchWishlistPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.page.next_cursor ?? undefined,
    enabled,
  });

/**
 * Is this product saved? One boolean per heart: `select` narrows the
 * shared list to a yes or no for `slug`, so when another product's heart is
 * tapped this one's result is the same boolean and it does not re-render
 * (TanStack Query re-renders an observer only when its selected result
 * changed). A catalog of 40 cards therefore re-renders 1 heart per tap, not
 * 40 (README, artikel 14).
 */
export const useIsWishlisted = (slug: string): boolean => {
  const select = useCallback(
    (slugs: readonly string[]) => slugs.includes(slug),
    [slug],
  );
  const { data } = useQuery({ ...wishlistIdsQuery(isSignedIn()), select });
  return data ?? false;
};

/**
 * Taps the heart of `slug`. Signed out: shows "Masuk dulu…" and calls
 * nothing. Signed in: flips the heart at once and tells the server
 * (toggle-options.ts has the optimistic update and its rollback).
 */
export const useToggleWishlist = () => {
  const client = useQueryClient();
  const mutation = useMutation(
    toggleMutationOptions(client, {
      add: addToWishlist,
      remove: removeFromWishlist,
      onApplied: ({ saved }) => {
        announce(saved ? "Disimpan ke wishlist" : "Dihapus dari wishlist");
      },
      onFailure: (error) => {
        showNotice(wishlistErrorMessage(error));
      },
    }),
  );
  const { mutate } = mutation;

  return useCallback(
    (slug: string, currentlySaved: boolean) => {
      if (!isSignedIn()) {
        showNotice(SIGN_IN_MESSAGE);
        return;
      }
      mutate({ slug, saved: !currentlySaved });
    },
    [mutate],
  );
};
