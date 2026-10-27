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
import type { CartKey } from "../api/queries.ts";
import { getCartToken, useCartStore } from "../cart-store.ts";
import { withLineQuantity } from "../optimistic-cart.ts";
import { CART_MUTATIONS } from "./useAddToCart.ts";

/** The most units one line may hold (the API's CartItemPatch). */
export const LINE_MAX_QUANTITY = 99;

/** One change to one line of the cart page, as the page asks for it. */
export type CartLineChange =
  /** A quantity; the same quantity again accepts a changed price. */
  | { kind: "quantity"; variantId: string; quantity: number }
  /** One more or one less than the line holds now (the stepper). */
  | { kind: "step"; variantId: string; delta: 1 | -1 }
  /** Remove the line. */
  | { kind: "remove"; variantId: string };

/** What is sent: a step has become a quantity by then. */
type SentChange = Exclude<CartLineChange, { kind: "step" }>;

/** What mutate takes: the change, and everything fixed at the click. */
interface ChangeVariables {
  change: SentChange;
  /** The logged-in user's id at the click, or null for a guest. */
  owner: string | null;
  /** The cache entry the change belongs to. */
  key: CartKey;
  /** The cart before this change's guess, for a rollback; undefined for a removal. */
  previous: Cart | undefined;
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
 *   Three quick presses on + send 2, 3 and 4, in that order.
 * - The owner is fixed at the click. A change clicked by a logged-in buyer
 *   whose session ends before its turn is not sent as a guest's (it would
 *   change a guest cart that does not have the line): it fails with
 *   401 UNAUTHORIZED, and nothing is written under the user's key.
 * - A new quantity is optimistic, and the guess is written at the click,
 *   synchronously, in `change` below, not in onMutate (which starts after
 *   an `await`). A step (+ or −) is computed from the cache as it is at
 *   that moment, so presses faster than a render each count from the one
 *   before, never from a quantity on screen that is already out of date.
 *   An error puts that click's snapshot back.
 * - A removal is not optimistic: the line stays, marked busy, until the
 *   API confirms, so a failed removal can show its error on the line it
 *   belongs to (an optimistic removal would unmount the line, and its
 *   error with it).
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

  /** Whether a write under `owner`'s key may still happen. */
  const mayWrite = (owner: string | null) =>
    owner === null || ownerNow() === owner;

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

    onError: (error, { owner, key, previous }) => {
      if (previous !== undefined && mayWrite(owner)) {
        queryClient.setQueryData(key, previous);
      }
      if (isApiError(error, "CART_NOT_FOUND")) forgetCart();
    },

    onSuccess: (cart, { owner, key }) => {
      if (mayWrite(owner)) queryClient.setQueryData(key, cart);
    },

    onSettled: (_cart, error) => {
      if (isApiError(error, "CART_NOT_FOUND")) return;
      if (queryClient.isMutating({ mutationKey: CART_MUTATIONS }) === 1) {
        void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      }
    },
  });

  /**
   * Sends `change` as the buyer who is logged in now, after writing its
   * guess into the cache. A step that would leave 1–99, or a line that is
   * not in the cache, sends nothing.
   */
  const change = (
    requested: CartLineChange,
    options?: { onSuccess?: () => void },
  ) => {
    const owner = ownerNow();
    const key = cartQueryOf(owner).queryKey;
    const previous = queryClient.getQueryData(key);
    let sent: SentChange;
    if (requested.kind === "step") {
      const line = previous?.lines.find(
        (each) => each.variant_id === requested.variantId,
      );
      if (line === undefined) return;
      const quantity = line.quantity + requested.delta;
      if (quantity < 1 || quantity > LINE_MAX_QUANTITY) return;
      sent = { kind: "quantity", variantId: requested.variantId, quantity };
    } else {
      sent = requested;
    }
    if (sent.kind === "quantity" && previous !== undefined) {
      // An older GET still on its way must not land on top of the guess.
      // cancelQueries aborts it at once; only its promise settles later.
      void queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(
        key,
        withLineQuantity(previous, sent.variantId, sent.quantity),
      );
    }
    mutation.mutate(
      {
        change: sent,
        owner,
        key,
        previous: sent.kind === "remove" ? undefined : previous,
      },
      options,
    );
  };

  return {
    ...mutation,
    change,
    /** The change this instance sent last, while it runs or after. */
    lastChange: mutation.variables?.change,
  };
};
