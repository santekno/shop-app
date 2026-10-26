import { create } from "zustand";

/**
 * The guest cart's client state: which cart is ours, and one message about
 * it. The cart itself (its lines, the subtotal) is server data and stays in
 * TanStack Query's cache (api/queries.ts); keeping a second copy here would
 * only give two copies that disagree after the next refetch.
 */
export interface CartState {
  /** The X-Cart-Token of the guest cart, or null before the first add. */
  token: string | null;
  /**
   * The API stopped knowing our token (CART_NOT_FOUND: the cart was cleaned
   * up or merged) and it was forgotten. The cart page says so once, so an
   * empty cart does not look like lost items without a reason.
   */
  cartExpired: boolean;
  /** Keeps the token of a cart the API just created. */
  setToken: (token: string) => void;
  /** Forgets a token the API no longer knows; the next add starts a new cart. */
  forgetCart: () => void;
  /** The buyer has read the "cart expired" message. */
  dismissCartExpired: () => void;
}

/**
 * A Zustand store: a hook (useCartStore) around state that lives outside
 * React. `create` takes a function that receives `set` and returns the
 * initial state together with the actions that change it; an action
 * calls `set` with the fields that change, and Zustand merges them in.
 *
 * Unlike context, nothing has to wrap the app in a provider, and a
 * component that reads one field with a selector renders again only when
 * that field changes:
 *
 *   const token = useCartStore((state) => state.token);
 *
 * Code outside a render reads the current state with getState(), which is
 * what a queued mutation needs (getCartToken below).
 *
 * The `()` after create<CartState> is how Zustand's TypeScript types are
 * written: the state type goes in the first call, the setup in the second.
 */
export const useCartStore = create<CartState>()((set) => ({
  token: null,
  cartExpired: false,
  setToken: (token) => {
    set({ token, cartExpired: false });
  },
  forgetCart: () => {
    // Without a token there is nothing to forget (and nothing to report):
    // a second CART_NOT_FOUND for the same cart changes nothing.
    set((state) =>
      state.token === null ? state : { token: null, cartExpired: true },
    );
  },
  dismissCartExpired: () => {
    set({ cartExpired: false });
  },
}));

/** Selectors, defined once so every reader picks the same field. */
export const selectCartToken = (state: CartState) => state.token;
export const selectCartExpired = (state: CartState) => state.cartExpired;

/**
 * The token as it is right now, for code that runs later than the render
 * it was created in (a mutation waiting in its queue): a value captured at
 * render time may have been replaced by then.
 */
export const getCartToken = (): string | null => useCartStore.getState().token;
