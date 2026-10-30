// Runs before every test file of the dashboard (vite.config.ts,
// test.setupFiles).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// No unit test reaches the network: a request fails at once instead of
// trying a real server. (Artikel 11 puts MSW here, as the network.)
globalThis.fetch = () =>
  Promise.reject(new TypeError("unit tests must not reach the network"));

// Testing Library unmounts what a test rendered only when `afterEach` is a
// global; Vitest's globals are off, so unmount here. Every test starts
// with an empty document, real timers, and the title it found.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.title = "";
});

// --- What jsdom does not have ---------------------------------------------
//
// Only the parts the dashboard calls, each as small as its callers need.

// <dialog>'s showModal() and close() (ConfirmDialog). jsdom has the
// element and its `open` attribute but not the methods. Like the browser:
// close() fires "close"; Escape (a "cancel" event) is left to the test.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// ResizeObserver: Recharts' responsive container watches its own size.
// jsdom lays nothing out, so there is never a size to report.
if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      // jsdom has no layout: nothing ever resizes.
    }
    unobserve() {
      // See observe().
    }
    disconnect() {
      // See observe().
    }
  };
}

// window.scrollTo: React Router's ScrollRestoration scrolls to the top
// after a navigation; jsdom prints "Not implemented" for it.
window.scrollTo = () => undefined;
