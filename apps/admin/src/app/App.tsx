import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import { queryClient } from "@/lib/query-client.ts";
import { reportCaughtError } from "@/lib/report-error.ts";
import { routes } from "./routes.tsx";

// Created once, when the module loads, never inside a component: a new
// router on every render would throw away the history.
const router = createBrowserRouter(routes);

/**
 * After a logout, or a session the API ended: forget every cached query,
 * so the next person at this browser never sees the last one's orders.
 * removeQueries, not clear(): the logout's own mutation is still settling.
 */
const onSessionEnd = () => {
  queryClient.removeQueries();
};

/**
 * The dashboard's providers, outermost first: the server-state cache
 * (TanStack Query), the session (context), then the router, so every page
 * can use both.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider onEnd={onSessionEnd}>
        {/* onError: every error a route's ErrorBoundary catches comes here,
            once (main.tsx leaves React's onCaughtError silent). */}
        <RouterProvider router={router} onError={reportCaughtError} />
      </SessionProvider>
      {/* Renders nothing in a production build. */}
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
