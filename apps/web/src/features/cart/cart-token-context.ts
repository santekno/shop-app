import { createContext, useContext } from "react";

/** The guest cart's token and the way to change it. */
export interface CartTokenValue {
  /** The X-Cart-Token of the guest cart, or null before the first add. */
  cartToken: string | null;
  setCartToken: (token: string | null) => void;
  /**
   * The token as it is right now, for code that runs later than the
   * render it was created in (a queued mutation): `cartToken` is the
   * value of that render, which a newer setCartToken may have replaced.
   */
  getCartToken: () => string | null;
}

/** null outside <CartTokenProvider>: useCartToken turns that into an error. */
export const CartTokenContext = createContext<CartTokenValue | null>(null);

/**
 * The guest cart token, from the nearest <CartTokenProvider>.
 *
 * Bab 9 keeps it in React state only, in memory: a reload forgets it,
 * and the buyer starts with an empty cart again (the old guest cart stays
 * on the server, unreachable, until it is cleaned up). Bab 10 moves it
 * into a Zustand store persisted to localStorage, so the cart survives a
 * reload, and merges it into the user's cart after login.
 */
export const useCartToken = (): CartTokenValue => {
  const value = useContext(CartTokenContext);
  if (value === null) {
    throw new Error("useCartToken must be used inside <CartTokenProvider>");
  }
  return value;
};
