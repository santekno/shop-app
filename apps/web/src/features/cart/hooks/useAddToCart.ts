import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EMPTY_CART, addCartItem, isApiError } from "@goshop/shared";
import type { CartItemAdd, Money } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import { cartKeys, cartQuery } from "../api/queries.ts";
import { useCartToken } from "../cart-token-context.ts";
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
 * Adds a variant to the guest cart (POST /v1/cart/items), optimistically.
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
 * has finished, and mutationFn reads the token then (getCartToken): the
 * cart the first one created.
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
 */
export const useAddToCart = () => {
  const queryClient = useQueryClient();
  const { getCartToken, setCartToken } = useCartToken();

  return useMutation({
    mutationKey: ADD_TO_CART,
    scope: { id: "cart" },

    // Runs when its turn in the queue comes, so it reads the token as it
    // is then, not as it was at the click.
    mutationFn: async ({ item }: AddToCartVariables) => {
      const sentToken = getCartToken();
      const result = await addCartItem(api, item, { cartToken: sentToken });
      // The cart the answer belongs to: a new guest cart, or the one sent.
      return { cart: result.cart, cartToken: result.cartToken ?? sentToken };
    },

    onMutate: async ({ item, unitPrice }) => {
      // The key from the query options carries the cached type (Cart), so
      // getQueryData and setQueryData below are typed.
      const key = cartQuery(getCartToken()).queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (cart = EMPTY_CART) =>
        withAddedItem(cart, item, unitPrice),
      );
      return { key, previous };
    },

    onError: (error, _variables, snapshot) => {
      if (snapshot !== undefined) {
        queryClient.setQueryData(snapshot.key, snapshot.previous);
      }
      // The token names no cart any more (cleaned up, or merged): forget
      // it; the next add starts a new guest cart.
      if (isApiError(error, "CART_NOT_FOUND")) setCartToken(null);
    },

    onSuccess: ({ cart, cartToken }, _variables, snapshot) => {
      queryClient.setQueryData(cartQuery(cartToken).queryKey, cart);
      if (cartToken === null || cartToken === getCartToken()) return;
      // The add created the guest cart. Its token, sent only this once, is
      // kept; the cart is already stored under its key, so the count never
      // drops back to 0 when the token changes. The guess under
      // ["cart", null] goes back to empty.
      queryClient.setQueryData(snapshot.key, EMPTY_CART);
      setCartToken(cartToken);
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
