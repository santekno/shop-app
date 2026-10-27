import { queryOptions } from "@tanstack/react-query";
import { EMPTY_CART, getCart, isApiError } from "@goshop/shared";
import type { ApiClient, Cart } from "@goshop/shared";
import { api } from "@/lib/api.ts";

/**
 * The cart's query keys. Whose cart it is is part of the key: another
 * token or another user is another cart, and must never be shown from
 * this one's cache entry.
 *
 *   ["cart"]                  every cart query (what a change invalidates)
 *   ["cart", token]           one guest cart; ["cart", null] before the first add
 *   ["cart", "user"]          every logged-in user's cart (what a logout removes)
 *   ["cart", "user", userId]  the logged-in user's cart (artikel 12)
 */
export const cartKeys = {
  all: ["cart"] as const,
  cart: (cartToken: string | null): CartKey => [...cartKeys.all, cartToken],
  users: (): CartKey => [...cartKeys.all, "user"],
  user: (userId: string): CartKey => [...cartKeys.users(), userId],
};

/**
 * The type of every cart key. One type for the guest's and the user's, so
 * the two queries below have the same type too, and useCart can pick
 * either with a plain `? :`. (`as const` would give each its own tuple
 * type, and TypeScript would refuse to treat them as one.)
 */
export type CartKey = readonly ["cart", ...(string | null)[]];

/**
 * GET /v1/cart for the guest cart `cartToken`. A guest who has not added
 * anything has no token and no cart: the API would answer an empty cart,
 * so the query answers it without asking.
 *
 * `onCartGone` is called when the API no longer knows the token; useCart
 * passes a function that forgets it. It is not part of the key: the key
 * says which cart, the callback only what to do when it is gone.
 */
export const cartQuery = (cartToken: string | null, onCartGone?: () => void) =>
  queryOptions({
    queryKey: cartKeys.cart(cartToken),
    queryFn: async ({ signal }): Promise<Cart> => {
      if (cartToken === null) return EMPTY_CART;
      try {
        return await getCart(api, { cartToken, signal });
      } catch (error) {
        // CART_NOT_FOUND: the token names no cart any more (cleaned up, or
        // merged). Asking again would fail the same way forever, so the
        // caller forgets the token (onCartGone) and the buyer sees what a
        // guest without a cart has: an empty cart.
        if (isApiError(error, "CART_NOT_FOUND") && onCartGone !== undefined) {
          onCartGone();
          return EMPTY_CART;
        }
        throw error;
      }
    },
  });

/**
 * GET /v1/cart for the logged-in user: `client` sends the access token,
 * and the API finds the user's cart by it (no X-Cart-Token). A user who
 * never added anything gets an empty cart.
 */
export const userCartQuery = (client: ApiClient, userId: string) =>
  queryOptions({
    queryKey: cartKeys.user(userId),
    queryFn: ({ signal }): Promise<Cart> => getCart(client, { signal }),
  });
