import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import type { ApiClient } from "@goshop/shared";
import { meKeys } from "@/features/account/api/queries.ts";
import { checkoutKeys } from "@/features/checkout/api/queries.ts";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import type { Session } from "@/features/auth/session-context.ts";
import {
  forgetUserCarts,
  mergeGuestCart,
} from "@/features/cart/merge-guest-cart.ts";
import { queryClient } from "@/lib/query-client.ts";
import { reportCaughtError } from "@/lib/report-error.ts";
import { routes } from "./routes.tsx";

// Created once, when the module loads, never inside a component: a new
// router on every render would throw away the history and the state of
// every page. createBrowserRouter is the "data router": it reads the real
// address bar and the history API, and it unlocks the data APIs (lazy
// routes, a route's ErrorBoundary, useNavigation) that later articles
// use. (Bab 8 had one page, chosen by a `selectedSlug` state; the URL now
// plays that role.)
const router = createBrowserRouter(routes);

/*
 * Where each kind of state lives (Bab 10, artikel 08). Ask, in order:
 *
 * 1. Is it the server's data (products, the cart's lines)? TanStack
 *    Query's cache: it fetches, shares, refetches and forgets it.
 * 2. Should a link or a reload bring it back (the product, a filter)?
 *    The URL.
 * 3. Does only one component, or one parent and its children, need it
 *    (a stepper's quantity, a folded list)? useState, lifted no higher
 *    than the closest common parent.
 * 4. Do distant parts of the page need it, and is it nobody's copy of
 *    server data? Then it is global: here, the session (context) and the
 *    guest cart's token (a Zustand store). Few things pass all four
 *    questions.
 */

/**
 * What a session's start and end mean for the cart (artikel 12). The auth
 * feature does not import the cart; the app wires the two together here.
 *
 * - A login or a restore moves the guest cart into the user's cart before
 *   the header shows the user (POST /v1/cart/merge).
 * - A logout, or a session the API ended, drops the user's cached cart,
 *   account (artikel 13) and checkout data (addresses, quotes; Bab 11), so
 *   the next person at this browser starts as a guest and never sees them.
 */
const onSessionStart = (client: ApiClient, session: Session) =>
  mergeGuestCart(client, queryClient, session.user.id);
const onSessionEnd = () => {
  forgetUserCarts(queryClient);
  queryClient.removeQueries({ queryKey: meKeys.all });
  queryClient.removeQueries({ queryKey: checkoutKeys.all });
};

export function App() {
  // The provider puts the QueryClient in React context, so every page
  // (inside the router) reads and fills the same cache. The session is
  // React context (SessionProvider). The guest cart's token needs no
  // provider: it lives in a Zustand store (features/cart/cart-store.ts),
  // which any component reads with a hook.
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider onStart={onSessionStart} onEnd={onSessionEnd}>
        {/* onError: every error a route's ErrorBoundary catches comes
            here, once (main.tsx leaves React's onCaughtError silent so it
            is not reported twice). Without it React Router logs each one
            itself, the expected 404 of a missing product included. */}
        <RouterProvider router={router} onError={reportCaughtError} />
      </SessionProvider>
      {/* A panel to inspect the cache (the flower button, bottom corner).
          The package renders nothing in a production build, and Vite
          drops its code from the bundle. */}
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
