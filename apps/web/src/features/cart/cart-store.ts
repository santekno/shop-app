import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

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
  /**
   * Forgets the token without a message: the guest cart was merged into
   * the user's cart after a login (artikel 12), so nothing was lost.
   */
  clearToken: () => void;
  /** The buyer has read the "cart expired" message. */
  dismissCartExpired: () => void;
}

/** The localStorage key. The value inside carries its own version. */
export const CART_STORAGE_KEY = "goshop:cart";

/**
 * The version of what is stored under CART_STORAGE_KEY. Raise it when the
 * stored shape changes, and teach `migrate` (below) the old shape.
 */
export const CART_STORAGE_VERSION = 1;

/** What is saved: the token only. A message is not worth a reload. */
type PersistedCart = Pick<CartState, "token">;

/**
 * localStorage, made safe to call. Reading `window.localStorage` itself
 * throws when storage is blocked (a privacy setting, a sandboxed frame),
 * and setItem throws when the quota is full. Losing the token is a small
 * price (the buyer starts a new cart); a thrown error would break the
 * page, so every call is wrapped.
 */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Not saved: the cart works until the page is closed.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing to do: there is nothing we could have saved either.
    }
  },
};

/**
 * Whatever is stored is untrusted input: an older version of the app, a
 * browser extension or the buyer's own DevTools may have written it. Only
 * a string (or null) is accepted as the token; anything else means no cart.
 * A string that is not a real token is refused by the API with
 * CART_NOT_FOUND, and forgotten like a stale one.
 */
const storedToken = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || !("token" in value)) {
    return null;
  }
  return typeof value.token === "string" && value.token !== ""
    ? value.token
    : null;
};

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
 *
 * `persist` (artikel 10) wraps the setup: after every change it writes the
 * part `partialize` picks to localStorage, and when the store is created it
 * reads it back. localStorage answers synchronously, so the token is there
 * before the first render, and the header asks the API for the right cart
 * at once; a reload keeps the cart (in Bab 9 it forgot it). A token the
 * API no longer knows is forgotten on the first GET /v1/cart
 * (CART_NOT_FOUND, see api/queries.ts), and the cart page says why.
 *
 * Stored as {"state":{"token":"…"},"version":1}.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      token: null,
      cartExpired: false,
      setToken: (token) => {
        set({ token, cartExpired: false });
      },
      forgetCart: () => {
        // Without a token there is nothing to forget (and nothing to
        // report): a second CART_NOT_FOUND for the same cart changes
        // nothing.
        set((state) =>
          state.token === null ? state : { token: null, cartExpired: true },
        );
      },
      clearToken: () => {
        set({ token: null, cartExpired: false });
      },
      dismissCartExpired: () => {
        set({ cartExpired: false });
      },
    }),
    {
      name: CART_STORAGE_KEY,
      version: CART_STORAGE_VERSION,
      storage: createJSONStorage<PersistedCart>(() => safeLocalStorage),
      // Only the token is saved; cartExpired and the actions are not.
      partialize: (state): PersistedCart => ({ token: state.token }),
      // A value saved under another version. There is no older shape to
      // convert yet, so it starts without a cart rather than guessing.
      // (Without `migrate`, Zustand would log an error and ignore it.)
      migrate: (): PersistedCart => ({ token: null }),
      // Combines what was read with the initial state; it is where the
      // stored value is checked before the app trusts it.
      merge: (persisted, current) => ({
        ...current,
        token: storedToken(persisted),
      }),
    },
  ),
);

/** Selectors, defined once so every reader picks the same field. */
export const selectCartToken = (state: CartState) => state.token;
export const selectCartExpired = (state: CartState) => state.cartExpired;

/**
 * The token as it is right now, for code that runs later than the render
 * it was created in (a mutation waiting in its queue): a value captured at
 * render time may have been replaced by then.
 */
export const getCartToken = (): string | null => useCartStore.getState().token;

/**
 * Keeps this tab's token in step with the others. Another tab that creates
 * a cart (or forgets one) writes localStorage, and the browser tells every
 * other tab of the same origin with a "storage" event; without this, two
 * tabs could each create their own guest cart. Returns the function that
 * stops listening. Called once, from main.tsx.
 */
export const syncCartAcrossTabs = (): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CART_STORAGE_KEY) void useCartStore.persist.rehydrate();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
};
