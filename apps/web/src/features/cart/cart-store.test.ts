import { describe, expect, it, vi } from "vitest";
import {
  getCartToken,
  selectCartExpired,
  selectCartToken,
  useCartStore,
} from "./cart-store.ts";

const state = () => useCartStore.getState();

describe("the cart store's actions", () => {
  it("starts without a cart and without a message", () => {
    expect(state().token).toBeNull();
    expect(state().cartExpired).toBe(false);
    expect(getCartToken()).toBeNull();
  });

  it("setToken keeps a new cart's token and clears the expired message", () => {
    useCartStore.setState({ cartExpired: true });

    state().setToken("tok");

    expect(state().token).toBe("tok");
    expect(state().cartExpired).toBe(false);
    expect(getCartToken()).toBe("tok");
    expect(selectCartToken(state())).toBe("tok");
  });

  it("forgetCart forgets the token and says the cart expired", () => {
    state().setToken("tok");

    state().forgetCart();

    expect(state().token).toBeNull();
    expect(state().cartExpired).toBe(true);
    expect(selectCartExpired(state())).toBe(true);
  });

  it("forgetCart without a token changes nothing and tells no one", () => {
    const listener = vi.fn();
    const unsubscribe = useCartStore.subscribe(listener);

    state().forgetCart();

    expect(state().cartExpired).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("clearToken forgets the token quietly: a merged cart lost nothing", () => {
    state().setToken("tok");

    state().clearToken();

    expect(state().token).toBeNull();
    expect(state().cartExpired).toBe(false);
  });

  it("dismissCartExpired closes the message and keeps the token", () => {
    useCartStore.setState({ token: "tok", cartExpired: true });

    state().dismissCartExpired();

    expect(state().cartExpired).toBe(false);
    expect(state().token).toBe("tok");
  });
});
