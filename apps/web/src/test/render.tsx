// Renders a page or the whole route tree the way the storefront does, but
// under a memory router and with a QueryClient of the test's own (an empty
// cache, the storefront's defaults: retry false): the test chooses the URL,
// and reads where a link or a navigation went from the location probe.
//
//   renderWithProviders(<CatalogPage />, { path: "/", url: "/?kategori=kaos" })
//   renderApp("/produk/kaos-polos")
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import type { InitialEntry, RouteObject } from "react-router";
import { routes } from "@/app/routes.tsx";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import type { Session } from "@/features/auth/session-context.ts";
import { createQueryClient } from "@/lib/query-client.ts";
import { LocationProbe } from "./LocationProbe.tsx";

/** Where the memory router is now ("/produk/kaos?x=1"). */
export const currentLocation = () => screen.getByTestId("location").textContent;

/** A QueryClient for one test: the storefront's defaults, an empty cache. */
export const createTestQueryClient = () => createQueryClient();

/**
 * The session a test starts with: a guest (`null`, the default), a logged-in
 * buyer, or `"restore"` to start "restoring" and ask the (fake) API with
 * POST /v1/auth/web/refresh, as the app does.
 */
export type TestSession = Session | null | "restore";

/**
 * The app-wide providers App puts around the router. The guest cart's token
 * needs no provider: it lives in the cart store (vitest.setup.ts resets it).
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
 * A renderHook wrapper with the app-wide providers (and a memory router,
 * for hooks that read the location): `renderHook(useX, { wrapper })`.
 */
export const hookWrapper =
  (
    queryClient: QueryClient = createTestQueryClient(),
    url: InitialEntry = "/",
    session: TestSession = null,
  ) =>
  ({ children }: { children: ReactNode }) =>
    providers(
      queryClient,
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
      session,
    );

interface RenderOptions {
  /** The route pattern `ui` is rendered at. Default: every path. */
  path?: string;
  /** The URL (or history entries) to start at. Default "/". */
  url?: InitialEntry | InitialEntry[];
  queryClient?: QueryClient;
  /** Who is logged in. Default: a guest, with no restore request. */
  session?: TestSession;
}

const entries = (url: InitialEntry | InitialEntry[]) =>
  Array.isArray(url) ? url : [url];

const mount = (
  routeObjects: RouteObject[],
  url: InitialEntry | InitialEntry[],
  queryClient: QueryClient,
  session: TestSession = null,
) => {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: entries(url),
  });
  const view = render(
    providers(queryClient, <RouterProvider router={router} />, session),
  );
  return { ...view, router, queryClient };
};

/**
 * Renders `ui` at `path` with the location probe beside it; any other
 * path shows the probe alone, so a link that leaves the page still lands
 * somewhere a test can read.
 */
export const renderWithProviders = (
  ui: ReactElement,
  {
    path = "*",
    url = "/",
    queryClient = createTestQueryClient(),
    session = null,
  }: RenderOptions = {},
) =>
  mount(
    [
      {
        path,
        element: (
          <>
            {ui}
            <LocationProbe />
          </>
        ),
      },
      ...(path === "*" ? [] : [{ path: "*", element: <LocationProbe /> }]),
    ],
    url,
    queryClient,
    session,
  );

/**
 * `ui` inside a declarative <MemoryRouter> and the providers, with the
 * location probe: for a component test that re-renders with new props
 * (`rerender(inRouter(…, client))` keeps the router, the cache and the
 * component's state).
 */
export const inRouter = (
  ui: ReactElement,
  queryClient: QueryClient = createTestQueryClient(),
  url: InitialEntry = "/",
  session: TestSession = null,
) =>
  providers(
    queryClient,
    <MemoryRouter initialEntries={[url]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
    session,
  );

/** Renders the storefront's own route tree (app/routes.tsx) at `url`. */
export const renderApp = (
  url: InitialEntry | InitialEntry[] = "/",
  queryClient: QueryClient = createTestQueryClient(),
  session: TestSession = null,
) => mount(routes, url, queryClient, session);
