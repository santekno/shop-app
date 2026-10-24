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
import { CartTokenProvider } from "@/features/cart/CartTokenProvider.tsx";
import { createQueryClient } from "@/lib/query-client.ts";
import { LocationProbe } from "./LocationProbe.tsx";

/** Where the memory router is now ("/produk/kaos?x=1"). */
export const currentLocation = () => screen.getByTestId("location").textContent;

/** A QueryClient for one test: the storefront's defaults, an empty cache. */
export const createTestQueryClient = () => createQueryClient();

/** The app-wide providers App puts around the router. */
export const providers = (queryClient: QueryClient, children: ReactNode) => (
  <QueryClientProvider client={queryClient}>
    <SessionProvider>
      <CartTokenProvider>{children}</CartTokenProvider>
    </SessionProvider>
  </QueryClientProvider>
);

interface RenderOptions {
  /** The route pattern `ui` is rendered at. Default: every path. */
  path?: string;
  /** The URL (or history entries) to start at. Default "/". */
  url?: InitialEntry | InitialEntry[];
  queryClient?: QueryClient;
}

const entries = (url: InitialEntry | InitialEntry[]) =>
  Array.isArray(url) ? url : [url];

const mount = (
  routeObjects: RouteObject[],
  url: InitialEntry | InitialEntry[],
  queryClient: QueryClient,
) => {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: entries(url),
  });
  const view = render(
    providers(queryClient, <RouterProvider router={router} />),
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
) =>
  providers(
    queryClient,
    <MemoryRouter initialEntries={[url]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );

/** Renders the storefront's own route tree (app/routes.tsx) at `url`. */
export const renderApp = (
  url: InitialEntry | InitialEntry[] = "/",
  queryClient: QueryClient = createTestQueryClient(),
) => mount(routes, url, queryClient);
