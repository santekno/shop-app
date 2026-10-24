import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addCartItem, isApiError } from "@goshop/shared";
import type { CartItemAdd } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import { cartKeys } from "../api/queries.ts";
import { useCartToken } from "../cart-token-context.ts";

/**
 * Adds a variant to the guest cart: POST /v1/cart/items.
 *
 * A query reads; a mutation changes something on the server. useMutation
 * does not run on render: `mutate(variables)` sends it, and the hook
 * reports `isPending`, `isSuccess`, `isError` and `error` for the last call.
 *
 * After a change on the server, the cached copies of what it changed are
 * out of date. `invalidateQueries` marks every cart query stale, and the
 * ones on screen (the header's count, the cart page) fetch again. That is
 * the simplest correct rule: the cache never decides what the server
 * did; it asks.
 */
export const useAddToCart = () => {
  const queryClient = useQueryClient();
  const { cartToken, setCartToken } = useCartToken();

  return useMutation({
    mutationFn: (item: CartItemAdd) => addCartItem(api, item, { cartToken }),
    onSuccess: async (result) => {
      // The first add created the guest cart: keep its token, sent once.
      if (result.cartToken !== undefined) setCartToken(result.cartToken);
      // Returning the promise keeps the mutation pending until the cart
      // has been fetched again, so "Ditambahkan" and the new count appear
      // together.
      await queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
    onError: (error) => {
      // The token names no cart any more (cleaned up, or merged): forget
      // it; the next add starts a new guest cart.
      if (isApiError(error, "CART_NOT_FOUND")) setCartToken(null);
    },
  });
};
