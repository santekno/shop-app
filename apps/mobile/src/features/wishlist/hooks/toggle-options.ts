// The wishlist toggle as a TanStack Query mutation with an optimistic
// update. Written as a function of the client and of the two requests, so
// the hook below passes the real ones and nothing else about it is tied to
// React or to the network.
import type { MutationOptions, QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { applyToggle } from "../wishlist-state";

export interface ToggleVariables {
  slug: string;
  /** The state the buyer asked for: true saves the product, false removes it. */
  saved: boolean;
}

/** What onMutate hands to onError: the list as it was before the tap. */
interface ToggleContext {
  previous: readonly string[] | undefined;
}

interface ToggleDeps {
  add: (slug: string) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  /** The visible message for a failed change (and for a rollback). */
  onFailure: (error: unknown) => void;
  /** Said to the screen reader when the change is made, before the server answers. */
  onApplied: (variables: ToggleVariables) => void;
}

/**
 * The optimistic update, in the four steps TanStack Query documents:
 *
 * 1. onMutate: cancel the saved-slugs fetch that may be in flight (its
 *    answer is from before this tap and would overwrite the heart), keep a
 *    snapshot, and write the new list straight into the cache. Every heart
 *    reads that cache, so the tapped one fills at once, wherever it is on
 *    screen.
 * 2. mutationFn: the PUT or DELETE. Both are idempotent (204 either way),
 *    so a tap repeated by a retry or by two fast fingers is harmless.
 * 3. onError: put the snapshot back (or, when another tap came after this
 *    one, undo only this product, so the later tap's heart stays) and say why (the 409 limit reads its
 *    number from details.max, see messages.ts).
 * 4. onSettled: refetch the list from the server, success or not, so the
 *    hearts end up showing what the server holds. Only the last of several
 *    pending toggles does, or the first one's refetch would land between
 *    two taps and flicker the second one back.
 *
 * `scope` makes toggles run one after the other, in the order tapped: a
 * PUT and a DELETE for the same product sent together could be processed
 * in either order by the server, and the heart would end up wrong.
 */
export const toggleMutationOptions = (
  client: QueryClient,
  deps: ToggleDeps,
): MutationOptions<void, unknown, ToggleVariables, ToggleContext> => ({
  mutationKey: queryKeys.wishlist.toggle,
  scope: { id: "wishlist" },
  mutationFn: ({ slug, saved }) => (saved ? deps.add(slug) : deps.remove(slug)),
  onMutate: async (variables) => {
    const key = queryKeys.wishlist.ids();
    await client.cancelQueries({ queryKey: key });
    const previous = client.getQueryData<readonly string[]>(key);
    client.setQueryData<readonly string[]>(key, (old) =>
      applyToggle(old, variables.slug, variables.saved),
    );
    deps.onApplied(variables);
    return { previous };
  },
  onError: (error, variables, context) => {
    const key = queryKeys.wishlist.ids();
    if (client.isMutating({ mutationKey: queryKeys.wishlist.toggle }) <= 1) {
      // The only toggle in flight: put the snapshot back. `undefined` (the
      // list had not loaded) means "nothing known"; onSettled refills it.
      client.setQueryData(key, context?.previous);
    } else {
      // Another tap happened after this one: its optimistic write is in the
      // cache, and the snapshot would erase it. Undo only this product.
      client.setQueryData<readonly string[]>(key, (old) =>
        applyToggle(old, variables.slug, !variables.saved),
      );
    }
    deps.onFailure(error);
  },
  onSettled: () => {
    if (client.isMutating({ mutationKey: queryKeys.wishlist.toggle }) === 1) {
      void client.invalidateQueries({ queryKey: queryKeys.wishlist.all });
    }
  },
});
