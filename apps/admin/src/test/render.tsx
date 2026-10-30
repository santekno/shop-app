// Renders a page or a component under the dashboard's providers: a
// QueryClient of the test's own (an empty cache, the app's defaults), the
// session the test chooses, and a memory router at the URL it chooses.
//
//   const { router } = renderRoute(<OrdersPage />, {
//     path: "/pesanan",
//     url: "/pesanan?status=diproses",
//   });
//   await user.click(screen.getByRole("link", { name: "Dikirim" }));
//   expect(router.state.location.search).toBe("?status=dikirim");
import type { QueryClient } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react";
import { createContext, use } from "react";
import type { ReactElement, ReactNode } from "react";
import { createMemoryRouter } from "react-router";
import type { RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { createQueryClient } from "@/lib/query-client.ts";
import { session as staffSession } from "./fixtures.ts";
import { Providers } from "./providers.tsx";
import type { TestSession } from "./providers.tsx";

export type { TestSession } from "./providers.tsx";

interface RouteOptions {
  /** The route pattern `ui` is rendered at. Default: "/". */
  path?: string;
  /** Where the router starts, or its history (the last entry is current). */
  url?: string | string[];
  session?: TestSession;
  queryClient?: QueryClient;
  /** Other routes beside `ui`'s, for links that leave the page. */
  routes?: RouteObject[];
  onEnd?: () => void;
}

/**
 * Renders `ui` as the element of the route `path` in a memory router
 * started at `url`. Any other URL renders nothing (a catch-all route), so
 * a test can follow a link away and read `router.state.location`.
 */
export const renderRoute = (
  ui: ReactElement,
  {
    path = "/",
    url = path,
    session = staffSession(),
    queryClient = createQueryClient(),
    routes = [],
    onEnd,
  }: RouteOptions = {},
) => {
  const router = createMemoryRouter(
    [{ path, element: ui }, ...routes, { path: "*", element: null }],
    { initialEntries: Array.isArray(url) ? url : [url] },
  );
  const view = render(
    <Providers queryClient={queryClient} session={session} onEnd={onEnd}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router, queryClient };
};

/**
 * Renders the dashboard's own route table (or another) at `url`: the
 * whole app below the providers, lazy routes included.
 */
export const renderRoutes = (
  routes: RouteObject[],
  {
    url = "/",
    session = staffSession(),
    queryClient = createQueryClient(),
    onEnd,
  }: Omit<RouteOptions, "path" | "routes"> = {},
) => {
  const router = createMemoryRouter(routes, {
    initialEntries: Array.isArray(url) ? url : [url],
  });
  const view = render(
    <Providers queryClient={queryClient} session={session} onEnd={onEnd}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router, queryClient };
};

/** What renderRouteHook's wrapper renders inside the router. */
const HookChildren = createContext<ReactNode>(null);

/** The router's one element: the hook's test component, from context. */
// A helper for tests, never hot-reloaded: Fast Refresh's rule does not apply.
// eslint-disable-next-line react-refresh/only-export-components
function HookHost() {
  return use(HookChildren);
}

/**
 * renderHook under the providers and a memory router at `url`: for a
 * hook that reads the URL, the session or the query cache. The router is
 * created once; the hook's component reaches it through context, so
 * `rerender` with new props works as usual.
 */
export const renderRouteHook = <Result, Props = undefined>(
  hook: (props: Props) => Result,
  {
    url = "/",
    session = staffSession(),
    queryClient = createQueryClient(),
    initialProps,
  }: Pick<RouteOptions, "session" | "queryClient"> & {
    url?: string;
    initialProps?: Props;
  } = {},
) => {
  const router = createMemoryRouter([{ path: "*", element: <HookHost /> }], {
    initialEntries: [url],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Providers queryClient={queryClient} session={session}>
      <HookChildren value={children}>
        <RouterProvider router={router} />
      </HookChildren>
    </Providers>
  );
  const view = renderHook(hook, {
    wrapper,
    initialProps: initialProps as Props,
  });
  return { ...view, queryClient, router };
};
