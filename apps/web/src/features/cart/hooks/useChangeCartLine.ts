import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  isApiError,
  removeCartItem,
  updateCartItem,
} from "@goshop/shared";
import type { Cart } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { api } from "@/lib/api.ts";
import { cartKeys, cartQuery, userCartQuery } from "../api/queries.ts";
import { getCartToken, useCartStore } from "../cart-store.ts";
import { withLineQuantity } from "../optimistic-cart.ts";
import { CART_MUTATIONS } from "./useAddToCart.ts";

/** One change to one line of the cart page. */
export type CartLineChange =
  /** A new quantity; the same quantity again accepts a changed price. */
  | { kind: "quantity"; variantId: string; quantity: number }
  /** Remove the line. */
  | { kind: "remove"; variantId: string };

/** What mutate takes: the change, plus who the buyer was at the click. */
interface ChangeVariables {
  change: CartLineChange;
  /** The logged-in user's id at the click, or null for a guest. */
  owner: string | null;
}

/**
 * Changes one line of the cart (PATCH or DELETE
 * /v1/cart/items/{variant_id}): a quantity, an accepted price, a removal.
 * Each line on the cart page has its own instance, so each line shows its
 * own "busy" state and its own error.
 *
 * The same rules as useAddToCart (Bab 10 artikel 14), for the same
 * reasons:
 *
 * - One queue: `scope: { id: "cart" }` is the add's scope too, so every
 *   write to the cart runs one after another, whichever page made it.
 *   Two quick presses on + send 3, then 4, never 4 before 3.
 * - The owner is fixed at the click. A change clicked by a logged-in buyer
 *   whose session ends before its turn is not sent as a guest's (it would
 *   change a guest cart that does not have the line): it fails with
 *   401 UNAUTHORIZED, and nothing is written under the user's key.
 * - A new quantity is optimistic: the stepper and the totals move at the
 *   click (withLineQuantity), and an error puts the snapshot back. A
 *   removal is not: the line stays, marked busy, until the API confirms,
 *   so a failed removal can show its error on the line it belongs to (an
 *   optimistic removal would unmount the line, and its error with it).
 * - The answer is the whole cart, so it replaces the cache; the last write
 *   of a burst refetches once, so the cache ends with the server's word.
 */
export const useChangeCartLine = () => {
  const queryClient = useQueryClient();
  const { authApi, getSession, ready } = useSession();
  const forgetCart = useCartStore((state) => state.forgetCart);

  const ownerNow = () => getSession()?.user.id ?? null;

  /** The cart query of `owner`: the user's, or this browser's guest cart. */
  const cartQueryOf = (owner: string | null) =>
    owner === null ? cartQuery(getCartToken()) : userCartQuery(authApi, owner);

  const mutation = useMutation({
    mutationKey: [...CART_MUTATIONS, "line"],
    scope: { id: "cart" },

    mutationFn: async ({ change, owner }: ChangeVariables): Promise<Cart> => {
      await ready();
      if (ownerNow() !== owner) {
        throw new ApiError({
          status: 401,
          code: "UNAUTHORIZED",
          message: "The session changed before this cart change was sent.",
        });
      }
      const client = owner === null ? api : authApi;
      const options = owner === null ? { cartToken: getCartToken() } : {};
      return change.kind === "remove"
        ? removeCartItem(client, change.variantId, options)
        : updateCartItem(
            client,
            change.variantId,
            { quantity: change.quantity },
            options,
          );
    },

    onMutate: async ({ change, owner }) => {
      const key = cartQueryOf(owner).queryKey;
      if (change.kind === "remove") return { key, previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous !== undefined) {
        queryClient.setQueryData(
          key,
          withLineQuantity(previous, change.variantId, change.quantity),
        );
      }
      return { key, previous };
    },

    onError: (error, { owner }, snapshot) => {
      if (
        snapshot?.previous !== undefined &&
        (owner === null || ownerNow() === owner)
      ) {
        queryClient.setQueryData(snapshot.key, snapshot.previous);
      }
      if (isApiError(error, "CART_NOT_FOUND")) forgetCart();
    },

    onSuccess: (cart, { owner }, snapshot) => {
      if (owner !== null && ownerNow() !== owner) return;
      queryClient.setQueryData(snapshot.key, cart);
    },

    onSettled: (_cart, error) => {
      if (isApiError(error, "CART_NOT_FOUND")) return;
      if (queryClient.isMutating({ mutationKey: CART_MUTATIONS }) === 1) {
        void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      }
    },
  });

  return {
    ...mutation,
    /** Sends `change` as the buyer who is logged in now. */
    change: (change: CartLineChange, options?: { onSuccess?: () => void }) => {
      mutation.mutate({ change, owner: ownerNow() }, options);
    },
    /** The change this instance sent last, while it runs or after. */
    lastChange: mutation.variables?.change,
  };
};
