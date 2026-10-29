import type { QueryClient } from "@tanstack/react-query";
import { isApiError, mergeCart } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";
import { cartKeys, userCartQuery } from "./api/queries.ts";
import { getCartToken, useCartStore } from "./cart-store.ts";

/**
 * Moves the guest cart into the user's cart, right after a login or a
 * restore (SessionProvider's onStart, wired in components/layout/Providers.tsx), before the header
 * switches to the user's cart: POST /v1/cart/merge with the guest token,
 * sent by `client`, which already carries the new access token.
 *
 * - Merged: the answer is the user's cart, so it goes straight into the
 *   cache under the user's key (no second GET), and the guest token is
 *   forgotten (the API has deleted that cart). Every tab follows through
 *   the "storage" event.
 * - CART_NOT_FOUND: the guest cart was already merged (in another tab) or
 *   cleaned up; forget the token, quietly: the user's cart is what shows.
 * - Anything else (the network, a server error): keep the token. The login
 *   has succeeded and must not fail because of the cart; the next login
 *   or reload tries the merge again.
 *
 * Never throws.
 */
export const mergeGuestCart = async (
  client: ApiClient,
  queryClient: QueryClient,
  userId: string,
): Promise<void> => {
  const token = getCartToken();
  if (token === null) return;
  try {
    const cart = await mergeCart(client, token);
    queryClient.setQueryData(userCartQuery(client, userId).queryKey, cart);
  } catch (error) {
    if (!isApiError(error, "CART_NOT_FOUND")) return;
  }
  useCartStore.getState().clearToken();
  queryClient.removeQueries({ queryKey: cartKeys.cart(token), exact: true });
};

/**
 * After a logout, or a session the API ended: drop every user's cart from
 * the cache, so the next person at this browser never sees it. The header
 * shows the guest cart again (empty: the guest's was merged).
 */
export const forgetUserCarts = (queryClient: QueryClient): void => {
  queryClient.removeQueries({ queryKey: cartKeys.users() });
};
