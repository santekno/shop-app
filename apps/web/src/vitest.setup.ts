// Runs before every test file of the storefront (vite.config.ts, test.setupFiles).
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { useCartStore } from "@/features/cart/cart-store.ts";

// Testing Library unmounts what a test rendered only when `afterEach` is a
// global; Vitest's globals are off, so unmount here. Every test starts
// with an empty document.
//
// The cart store is a module-level singleton persisted to localStorage, and
// the theme lives on <html> and in localStorage: none of it is unmounted, so
// it is reset here too, and no test sees the previous one's cart or theme.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.theme;
  useCartStore.setState({ token: null, cartExpired: false });
});

// jsdom has no scrolling: window.scrollTo only reports "Not implemented".
// The router's ScrollRestoration calls it on every navigation.
window.scrollTo = () => undefined;

// No unit test reaches the network: the API module is mocked with the
// fake API, or the test stubs fetch itself. A request that slips through
// fails at once instead of trying a real server.
globalThis.fetch = () =>
  Promise.reject(new TypeError("unit tests must not reach the network"));
