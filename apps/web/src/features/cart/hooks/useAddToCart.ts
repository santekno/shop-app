import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, EMPTY_CART, addCartItem, isApiError } from "@goshop/shared";
import type { CartItemAdd, Money } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { api } from "@/lib/api.ts";
import { cartKeys, cartQuery, userCartQuery } from "../api/queries.ts";
import { getCartToken, useCartStore } from "../cart-store.ts";
import { withAddedItem } from "../optimistic-cart.ts";

/** What `mutate` takes: the request body, plus the price for the guess. */
export interface AddToCartVariables {
  /** Sent as the body of POST /v1/cart/items, exactly as it is. */
  item: CartItemAdd;
  /** The variant's price on screen, for the optimistic subtotal. */
  unitPrice: Money;
}

/** Every add to the cart, wherever it is made: one queue, one key. */
const ADD_TO_CART = ["cart", "add"] as const;

/**
 * Adds a variant to the cart (POST /v1/cart/items), optimistically: the
 * logged-in user's cart (the access token says whose), or else the guest
 * cart (X-Cart-Token).
 *
 * A query reads; a mutation changes something on the server. useMutation
 * does not run on render: `mutate(variables)` sends it, and the hook
 * reports `isPending`, `isSuccess`, `isError` and `error` for the last call.
 *
 * Optimistic: the cache shows the cart as it will be before the server
 * answers, so the header's count goes up at the click, not half a second
 * later. Every optimistic update has the same steps:
 *
 * 1. onMutate: cancel cart requests in flight (an older answer must not
 *    land on top of the guess), keep a snapshot of the cache, write the
 *    guess. What it returns reaches the other callbacks.
 * 2. onError: put the snapshot back (the rollback); the error shows at once.
 * 3. onSuccess: the API answers with the whole cart, so it replaces the
 *    guess directly.
 * 4. onSettled: whatever happened, ask the server for the cart once more,
 *    in the background (see below why).
 *
 * One queue (`scope`). Each page's AddToCart disables its button while its
 * own add runs, but two adds can still overlap: leave the product page
 * while an add is on its way, come back, add again. Two guest carts could
 * be created (both sent without a token), and two answers could land in
 * either order. Mutations with the same scope id run one after another,
 * across every component, so the second add starts only when the first
 * has finished, and mutationFn reads the token then (getCartToken, from
 * the cart store): the cart the first one created.
 *
 * onMutate does not wait in that queue: it runs at the click, so the
 * count still moves at once. A guess made while an earlier add was still
 * on its way, and a snapshot taken then, may be out of date by the time
 * its own answer arrives. That is why onSettled refetches: the cache ends
 * with the server's word. Only the last add of a burst does it, so the
 * refetch never overwrites the guess of an add still waiting.
 *
 * Artikel 06 invalidated the cart after every add instead: simpler, one
 * extra request, and a count that moves only after the round trip.
 *
 * A session that ends while a logged-in add is on its way (logged out in
 * another tab, revoked) makes the add fail with 401 UNAUTHORIZED rather
 * than turn into a guest's add (artikel 14). The buyer sees the error and
 * the header's "Masuk". Nothing is written back under the user's key
 * afterwards, neither the rollback nor an answer: onEnd has just removed
 * that user's cart from the cache, and it must stay removed.
 *
 * An add clicked while logged in but still waiting in the queue when the
 * session ends is sent as a guest's: by its turn the buyer is a visitor,
 * and the item lands in a guest cart whose token is kept. Its guess was
 * written under the user's key, so onSuccess does not reset it there.
 */
export const useAddToCart = () => {
  const queryClient = useQueryClient();
  // The session's functions never change; the session itself is read with
  // getSession() when each step runs, never captured from this render.
  const { authApi, getSession, ready } = useSession();
  // The store's actions; the token itself is read with getCartToken() at
  // the moment each step runs, never captured from this render.
  const setToken = useCartStore((state) => state.setToken);
  const forgetCart = useCartStore((state) => state.forgetCart);

  /**
   * Whether a write under a user's key may still happen: always for a
   * guest's key (`owner` null), and for a user's only while that user is
   * still the one logged in.
   */
  const mayWrite = (owner: string | null) =>
    owner === null || getSession()?.user.id === owner;

  /** The query of the cart an add made now would change. */
  const currentCartQuery = () => {
    const session = getSession();
    return session === null
      ? cartQuery(getCartToken())
      : userCartQuery(authApi, session.user.id);
  };

  return useMutation({
    mutationKey: ADD_TO_CART,
    scope: { id: "cart" },

    // Runs when its turn in the queue comes, so it reads the session and
    // the token as they are then, not as they were at the click.
    mutationFn: async ({ item }: AddToCartVariables) => {
      // A click during the start-up restore waits for it: adding as a
      // guest and then turning out to be logged in would start a guest
      // cart nobody merges.
      await ready();
      const session = getSession();
      if (session !== null) {
        const result = await addCartItem(authApi, item);
        // The API answers with a cart token only when it took the request
        // as a guest's (no access token) and created a guest cart for it.
        // authApi never sends a logged-in add without the token, so this
        // is a guard, not a path: if it ever happens, the item is in a cart
        // that no token here points to, and an error says so honestly.
        if (result.cartToken !== undefined) {
          throw new ApiError({
            status: 401,
            code: "UNAUTHORIZED",
            message: "The add was answered as a guest's, not the user's.",
          });
        }
        return {
          cart: result.cart,
          key: userCartQuery(authApi, session.user.id).queryKey,
          owner: session.user.id,
          newCartToken: undefined,
        };
      }
      const sentToken = getCartToken();
      const result = await addCartItem(api, item, { cartToken: sentToken });
      // The cart the answer belongs to: a new guest cart, or the one sent.
      const token = result.cartToken ?? sentToken;
      return {
        cart: result.cart,
        key: cartQuery(token).queryKey,
        owner: null,
        newCartToken: token === null || token === sentToken ? undefined : token,
      };
    },

    onMutate: async ({ item, unitPrice }) => {
      // The key from the query options carries the cached type (Cart), so
      // getQueryData and setQueryData below are typed.
      const owner = getSession()?.user.id ?? null;
      const key = currentCartQuery().queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (cart = EMPTY_CART) =>
        withAddedItem(cart, item, unitPrice),
      );
      return { key, owner, previous };
    },

    onError: (error, _variables, snapshot) => {
      // No rollback into a user's cart whose session has ended: onEnd
      // removed it, guess included, and the snapshot would bring it back.
      if (snapshot !== undefined && mayWrite(snapshot.owner)) {
        queryClient.setQueryData(snapshot.key, snapshot.previous);
      }
      // The token names no cart any more (cleaned up, or merged): forget
      // it; the next add starts a new guest cart.
      if (isApiError(error, "CART_NOT_FOUND")) forgetCart();
    },

    onSuccess: ({ cart, key, owner, newCartToken }, _variables, snapshot) => {
      // The session ended after the API answered: same reason as onError.
      if (!mayWrite(owner)) return;
      queryClient.setQueryData(key, cart);
      if (newCartToken === undefined) return;
      // The add created the guest cart. Its token, sent only this once, is
      // kept; the cart is already stored under its key, so the count never
      // drops back to 0 when the token changes. The guess under
      // ["cart", null] goes back to empty, but only when the guess was a
      // guest's: an add clicked as a user whose session ended while it
      // waited made its guess under the user's key, which onEnd removed.
      if (snapshot.owner === null) {
        queryClient.setQueryData(snapshot.key, EMPTY_CART);
      }
      setToken(newCartToken);
    },

    onSettled: (_data, error) => {
      // A cart that is gone has nothing to refetch; onError forgot it.
      if (isApiError(error, "CART_NOT_FOUND")) return;
      // isMutating counts this add too: 1 means no other add is waiting.
      // Not awaited: the message and the button do not wait for it.
      if (queryClient.isMutating({ mutationKey: ADD_TO_CART }) === 1) {
        void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      }
    },
  });
};
