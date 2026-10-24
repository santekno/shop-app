// Runs before every test file of the storefront (vite.config.ts, test.setupFiles).
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts what a test rendered only when `afterEach` is a
// global; Vitest's globals are off, so unmount here. Every test starts
// with an empty document.
afterEach(() => {
  cleanup();
});

// jsdom has no scrolling: window.scrollTo only reports "Not implemented".
// The router's ScrollRestoration calls it on every navigation.
window.scrollTo = () => undefined;
