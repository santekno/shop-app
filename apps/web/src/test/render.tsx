// Renders a page or the whole route tree the way the storefront does, but
// under a memory router: the test chooses the URL, and reads where a link
// or a navigation went from the location probe.
//
//   renderWithProviders(<CatalogPage />, { path: "/", url: "/?kategori=kaos" })
//   renderApp("/produk/kaos-polos")
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { InitialEntry, RouteObject } from "react-router";
import { routes } from "@/app/routes.tsx";
import { LocationProbe } from "./LocationProbe.tsx";

/** Where the memory router is now ("/produk/kaos?x=1"). */
export const currentLocation = () => screen.getByTestId("location").textContent;

interface RenderOptions {
  /** The route pattern `ui` is rendered at. Default: every path. */
  path?: string;
  /** The URL (or history entries) to start at. Default "/". */
  url?: InitialEntry | InitialEntry[];
}

const entries = (url: InitialEntry | InitialEntry[]) =>
  Array.isArray(url) ? url : [url];

const mount = (
  routeObjects: RouteObject[],
  url: InitialEntry | InitialEntry[],
) => {
  const router = createMemoryRouter(routeObjects, {
    initialEntries: entries(url),
  });
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
};

/**
 * Renders `ui` at `path` with the location probe beside it; any other
 * path shows the probe alone, so a link that leaves the page still lands
 * somewhere a test can read.
 */
export const renderWithProviders = (
  ui: ReactElement,
  { path = "*", url = "/" }: RenderOptions = {},
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
  );

/** Renders the storefront's own route tree (app/routes.tsx) at `url`. */
export const renderApp = (url: InitialEntry | InitialEntry[] = "/") =>
  mount(routes, url);
