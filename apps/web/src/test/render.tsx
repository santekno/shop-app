// Renders a component or the whole storefront at a URL of the test's
// choosing, under the memory router (memory-router.ts, which stands in for
// Next.js' App Router) and with a QueryClient of the test's own (an empty
// cache, the storefront's defaults: retry false). Where a link or a
// navigation went is read from currentLocation().
//
//   renderWithProviders(<CatalogPage />, { path: "/", url: "/?kategori=kaos" })
//   renderApp("/produk/kaos-polos")
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { SiteFrame } from "@/components/layout/SiteFrame.tsx";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import type { Session } from "@/features/auth/session-context.ts";
import { createQueryClient } from "@/lib/query-client.ts";
import { matchPattern } from "./app-routes.ts";
import { AppPages } from "./app-tree.tsx";
import {
  currentUrl,
  startAt,
  testRouter,
  usePathname,
} from "./memory-router.ts";

/** Where the memory router is now ("/produk/kaos?x=1"). */
export const currentLocation = () => currentUrl();

/** A QueryClient for one test: the storefront's defaults, an empty cache. */
export const createTestQueryClient = () => createQueryClient();

/**
 * The session a test starts with: a guest (`null`, the default), a logged-in
 * buyer, or `"restore"` to start "restoring" and ask the (fake) API with
 * POST /v1/auth/web/refresh, as the app does.
 */
export type TestSession = Session | null | "restore";

/**
 * The app-wide providers (components/layout/Providers.tsx gives the app
 * the same two), with the test's client and session. The guest cart's
 * token needs no provider: it lives in the cart store (vitest.setup.ts
 * resets it).
 */
export const providers = (
  queryClient: QueryClient,
  children: ReactNode,
  session: TestSession = null,
) => (
  <QueryClientProvider client={queryClient}>
    <SessionProvider
      initialSession={session === "restore" ? undefined : session}
    >
      {children}
    </SessionProvider>
  </QueryClientProvider>
);

/**
 * A renderHook wrapper with the app-wide providers, the memory router
 * started at `url`: `renderHook(useX, { wrapper })`.
 */
export const hookWrapper = (
  queryClient: QueryClient = createTestQueryClient(),
  url = "/",
  session: TestSession = null,
) => {
  startAt(url);
  return ({ children }: { children: ReactNode }) =>
    providers(queryClient, children, session);
};

interface RenderOptions {
  /**
   * The URL pattern `ui` is rendered at ("/produk/[slug]"); at any other
   * URL it is not rendered, like a page the router left. Default: every
   * URL.
   */
  path?: string;
  /** The URL to start at, or the history entries (the last is current). */
  url?: string | string[];
  queryClient?: QueryClient;
  /** Who is logged in. Default: a guest, with no restore request. */
  session?: TestSession;
}

/** `ui` while the URL matches `path`, nothing after a link leaves it. */
function AtPath({ path, children }: { path: string; children: ReactNode }) {
  const pathname = usePathname();
  if (path === "*") return children;
  return matchPattern(path, pathname) === undefined ? null : children;
}

/** Renders `ui` at `url` with the app-wide providers. */
export const renderWithProviders = (
  ui: ReactElement,
  {
    path = "*",
    url = "/",
    queryClient = createTestQueryClient(),
    session = null,
  }: RenderOptions = {},
) => {
  startAt(url);
  const view = render(
    providers(queryClient, <AtPath path={path}>{ui}</AtPath>, session),
  );
  return { ...view, router: testRouter, queryClient };
};

/**
 * `ui` inside the providers: for a component test that re-renders with
 * new props (`rerender(inRouter(…, client))` keeps the cache and the
 * component's state). Does not move the router; pass `url` to start it
 * somewhere else than where the last test left it ("/").
 */
export const inRouter = (
  ui: ReactElement,
  queryClient: QueryClient = createTestQueryClient(),
  url?: string,
  session: TestSession = null,
) => {
  if (url !== undefined) startAt(url);
  return providers(queryClient, ui, session);
};

/**
 * Renders the storefront at `url`: SiteFrame (the header, the skip link,
 * <main>) around the page Next.js would render there (app-tree.tsx).
 */
export const renderApp = (
  url: string | string[] = "/",
  queryClient: QueryClient = createTestQueryClient(),
  session: TestSession = null,
) => {
  startAt(url);
  const view = render(
    providers(
      queryClient,
      <SiteFrame>
        <AppPages />
      </SiteFrame>,
      session,
    ),
  );
  return { ...view, router: testRouter, queryClient };
};
