"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { ApiClient } from "@goshop/shared";
import { meKeys } from "@/features/account/api/queries.ts";
import { checkoutKeys } from "@/features/checkout/api/queries.ts";
import { orderKeys } from "@/features/orders/api/queries.ts";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import type { Session } from "@/features/auth/session-context.ts";
import { syncCartAcrossTabs } from "@/features/cart/cart-store.ts";
import {
  forgetUserCarts,
  mergeGuestCart,
} from "@/features/cart/merge-guest-cart.ts";
import { getQueryClient } from "@/lib/query-client.ts";

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
 * The providers every page renders inside (Bab 11 artikel 08: what Bab
 * 7–10's App.tsx was, minus the router, which is now the app/ folder).
 *
 * A client component ("use client"): context, effects and the browser's
 * QueryClient exist only in client components. The root layout, a server
 * component, renders it and passes the page in as `children`; a server
 * component passed as children stays a server component.
 */
export function Providers({ children }: { children: ReactNode }) {
  // On the server a new client per request, in the browser one for the
  // whole visit (lib/query-client.ts). Called during render, not in
  // useState: getQueryClient already keeps the browser's one.
  const queryClient = getQueryClient();

  // The guest cart's token is saved in localStorage; follow other tabs'
  // changes to it (Bab 10 artikel 10). main.tsx did this before.
  useEffect(() => syncCartAcrossTabs(), []);

  /**
   * What a session's start and end mean for the cart (Bab 10 artikel 12).
   * The auth feature does not import the cart; the app wires the two
   * together here.
   *
   * - A login or a restore moves the guest cart into the user's cart
   *   before the header shows the user (POST /v1/cart/merge).
   * - A logout, or a session the API ended, drops the user's cached cart,
   *   account, checkout data and orders, so the next person at this
   *   browser starts as a guest and never sees them.
   */
  const onSessionStart = (client: ApiClient, session: Session) =>
    mergeGuestCart(client, queryClient, session.user.id);
  const onSessionEnd = () => {
    forgetUserCarts(queryClient);
    queryClient.removeQueries({ queryKey: meKeys.all });
    queryClient.removeQueries({ queryKey: checkoutKeys.all });
    queryClient.removeQueries({ queryKey: orderKeys.all });
  };

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider onStart={onSessionStart} onEnd={onSessionEnd}>
        {children}
      </SessionProvider>
      {/* A panel to inspect the cache (the flower button, bottom corner).
          It renders nothing in a production build. */}
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
