import { getCartToken, useCartStore } from "./cart-store.ts";

/*
 * A bridge for the Bab 9 unit tests only; no application code imports it.
 *
 * Bab 9 kept the guest cart token in React context (useCartToken inside
 * <CartTokenProvider>). Bab 10 artikel 09 moved it into the Zustand store
 * in cart-store.ts, which the app now reads directly. Until the tests move
 * to the store, this file gives them the old shape on top of it. Delete it,
 * with CartTokenProvider.tsx, when no test imports either.
 */

/** The old context value: the token and two ways to change or read it. */
export interface CartTokenValue {
  cartToken: string | null;
  setCartToken: (token: string | null) => void;
  getCartToken: () => string | null;
}

const setCartToken = (token: string | null) => {
  const { setToken, forgetCart } = useCartStore.getState();
  if (token === null) {
    forgetCart();
  } else {
    setToken(token);
  }
};

/** Bab 9's useCartToken, read from the cart store. */
export const useCartToken = (): CartTokenValue => ({
  cartToken: useCartStore((state) => state.token),
  setCartToken,
  getCartToken,
});
