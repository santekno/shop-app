import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CART_STORAGE_KEY,
  CART_STORAGE_VERSION,
  getCartToken,
  selectCartExpired,
  selectCartToken,
  syncCartAcrossTabs,
  useCartStore,
} from "./cart-store.ts";

const state = () => useCartStore.getState();
const stored = () => window.localStorage.getItem(CART_STORAGE_KEY);

/** What another tab, an older app or DevTools left under the key. */
const store = (value: unknown) => {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};

/** Storage blocked: reading window.localStorage itself throws. */
const blockStorage = () =>
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("the cart store in localStorage", () => {
  it("saves the token only, with its version", () => {
    state().setToken("tok");

    expect(stored()).toBe(
      JSON.stringify({ state: { token: "tok" }, version: 1 }),
    );
    expect(CART_STORAGE_KEY).toBe("goshop:cart");
    expect(CART_STORAGE_VERSION).toBe(1);
  });

  it("never saves the expired message", () => {
    state().setToken("tok");
    state().forgetCart();

    expect(JSON.parse(stored() ?? "null")).toEqual({
      state: { token: null },
      version: 1,
    });
  });

  it("reads a saved token back (a reload)", async () => {
    store({ state: { token: "saved" }, version: 1 });

    await useCartStore.persist.rehydrate();

    expect(state().token).toBe("saved");
    expect(state().cartExpired).toBe(false);
  });

  it.each([
    ["a number", { state: { token: 123 }, version: 1 }],
    ["an empty string", { state: { token: "" }, version: 1 }],
    ["an object", { state: { token: { id: "x" } }, version: 1 }],
    ["no token field", { state: {}, version: 1 }],
    ["a null state", { state: null, version: 1 }],
    ["a string state", { state: "tok", version: 1 }],
  ])(
    "starts without a cart when the saved token is %s",
    async (_name, value) => {
      useCartStore.setState({ token: "before" });
      store(value);

      await useCartStore.persist.rehydrate();

      expect(state().token).toBeNull();
    },
  );

  it("starts without a cart for a value saved under another version", async () => {
    useCartStore.setState({ token: "before" });
    store({ state: { token: "from-v0" }, version: 0 });

    await useCartStore.persist.rehydrate();

    expect(state().token).toBeNull();
  });

  it("keeps working when what is saved is not JSON", async () => {
    store("{not json");

    await expect(useCartStore.persist.rehydrate()).resolves.toBeUndefined();
    expect(state().token).toBeNull();
    state().setToken("tok");
    expect(state().token).toBe("tok");
  });

  it("keeps the cart in memory when storage is blocked", async () => {
    blockStorage();

    expect(() => {
      state().setToken("tok");
    }).not.toThrow();
    expect(state().token).toBe("tok");
    expect(() => {
      useCartStore.persist.clearStorage();
    }).not.toThrow();
    // Nothing can be read: a reload under blocked storage has no cart.
    await expect(useCartStore.persist.rehydrate()).resolves.toBeUndefined();
    expect(state().token).toBeNull();
  });

  it("keeps the cart in memory when the quota is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => {
      state().setToken("tok");
    }).not.toThrow();
    expect(state().token).toBe("tok");
    expect(stored()).toBeNull();
  });

  it("removes the saved value through clearStorage", () => {
    state().setToken("tok");

    useCartStore.persist.clearStorage();

    expect(stored()).toBeNull();
  });
});

describe("syncCartAcrossTabs", () => {
  /** Another tab wrote `token`; the browser tells this one. */
  const otherTabWrites = (key: string, token: string) => {
    store({ state: { token }, version: 1 });
    window.dispatchEvent(new StorageEvent("storage", { key }));
  };

  it("takes the token another tab saved", async () => {
    const stop = syncCartAcrossTabs();

    otherTabWrites(CART_STORAGE_KEY, "from-tab-b");

    await vi.waitFor(() => {
      expect(state().token).toBe("from-tab-b");
    });
    stop();
  });

  it("follows another tab that forgot the cart", async () => {
    state().setToken("tok");
    const stop = syncCartAcrossTabs();

    window.localStorage.removeItem(CART_STORAGE_KEY);
    window.dispatchEvent(
      new StorageEvent("storage", { key: CART_STORAGE_KEY }),
    );

    await vi.waitFor(() => {
      expect(state().token).toBeNull();
    });
    stop();
  });

  it("ignores a change to another key", async () => {
    const stop = syncCartAcrossTabs();

    otherTabWrites("goshop:theme", "from-tab-b");
    await Promise.resolve();

    expect(state().token).toBeNull();
    stop();
  });

  it("stops listening when its cleanup runs", async () => {
    const stop = syncCartAcrossTabs();
    stop();

    otherTabWrites(CART_STORAGE_KEY, "from-tab-b");
    await Promise.resolve();

    expect(state().token).toBeNull();
  });
});
