// Runs before every test file of the dashboard (vite.config.ts,
// test.setupFiles).
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";
import {
  refuseAndRecordUnhandled,
  server,
  takeUnhandledRequests,
} from "@/test/msw/server.ts";

// MSW is the network (src/test/msw/): a test answers the requests it
// expects with handlers. A request no handler answers is refused (the
// client sees a network error) AND recorded, and the afterEach below fails
// the test that sent it. Refusing alone is not enough: MSW's "error"
// strategy fails only the request, and a test whose code swallows that
// error (a background refresh, say) would still pass. Started here, at the
// top, not in beforeAll: lib/api.ts keeps the fetch it finds when its
// module loads (createApiClient's default), which happens while the test
// file is imported, before any beforeAll runs. Started first, MSW's fetch
// is the one it keeps.
server.listen({ onUnhandledFrame: refuseAndRecordUnhandled });
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
  const unhandled = takeUnhandledRequests();
  if (unhandled.length > 0) {
    throw new Error(
      `No MSW handler answered ${unhandled.join(", ")}. Answer it in the test (server.use(...)).`,
    );
  }
});
afterAll(() => {
  server.close();
  // A request sent after the file's last test (a refetch that outlived
  // it) has no test left to fail: fail the file.
  const unhandled = takeUnhandledRequests();
  if (unhandled.length > 0) {
    throw new Error(
      `No MSW handler answered ${unhandled.join(", ")} (sent after the last test).`,
    );
  }
});

// findBy* and waitFor give up after 10 s instead of 1 s: make test-unit
// runs every workspace's tests at once with coverage, and on a busy
// machine a lazy route's chunk or a first render can take over a second.
// A test that waits for something that never comes still fails, later.
// (3 s was not enough at a load average of 45: AccountNav and the
// /keranjang page took just over it.) Waiting is free when the element
// comes; only a failure takes longer.
configure({ asyncUtilTimeout: 10_000 });

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
