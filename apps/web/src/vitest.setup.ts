// Runs before every test file of the storefront (vite.config.ts, test.setupFiles).
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useCartStore } from "@/features/cart/cart-store.ts";
import { startAt } from "@/test/memory-router.ts";

// Next.js' App Router exists only under `next dev` / `next start`. Its
// hooks and <Link> run on the memory router instead (src/test/
// memory-router.ts). notFound(), redirect() and the rest of next/navigation
// stay Next.js' own: they throw the errors app-tree.tsx's boundaries catch.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  const router = await import("@/test/memory-router.ts");
  return {
    ...actual,
    useRouter: router.useRouter,
    usePathname: router.usePathname,
    useSearchParams: router.useSearchParams,
    useParams: router.useParams,
  };
});
vi.mock("next/link", () => import("@/test/next-link.tsx"));

// findBy* and waitFor give up after 3 s instead of 1 s: make test-unit
// runs every workspace's tests at once with coverage, and on a busy
// machine a first render can take over a second (AccountNav and Providers
// timed out that way). A test that waits for something that never comes
// still fails, later.
configure({ asyncUtilTimeout: 3_000 });

// Testing Library unmounts what a test rendered only when `afterEach` is a
// global; Vitest's globals are off, so unmount here. Every test starts
// with an empty document.
//
// The cart store is a module-level singleton persisted to localStorage, and
// the theme lives on <html> and in localStorage: none of it is unmounted, so
// it is reset here too, and no test sees the previous one's cart or theme.
// The memory router goes back to "/".
afterEach(() => {
  cleanup();
  // The store first: its persist middleware writes the reset token to
  // localStorage, which is then cleared.
  useCartStore.setState({ token: null, cartExpired: false });
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.theme;
  startAt("/");
});

// No unit test reaches the network: the API module is mocked with the
// fake API, or the test stubs fetch itself. A request that slips through
// fails at once instead of trying a real server.
globalThis.fetch = () =>
  Promise.reject(new TypeError("unit tests must not reach the network"));
