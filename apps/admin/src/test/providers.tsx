// The app-wide providers (App.tsx gives the app the same two) with the
// test's QueryClient and session. A file of its own: render.tsx exports
// functions, and a .tsx file may export components only, or Fast Refresh
// (and its lint rule) refuses it.
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionProvider } from "@/features/auth/SessionProvider.tsx";
import type { Session } from "@/features/auth/session-context.ts";

/**
 * The session a test starts with: a logged-in user (a seller by default),
 * nobody (`null`), or `"restore"` to start "restoring" and ask the API
 * with POST /v1/auth/web/refresh, as the app does.
 */
export type TestSession = Session | null | "restore";

/** The app-wide providers (App.tsx) around `children`. */
export const Providers = ({
  queryClient,
  session,
  onEnd,
  children,
}: {
  queryClient: QueryClient;
  session: TestSession;
  onEnd?: () => void;
  children: ReactNode;
}) => (
  <QueryClientProvider client={queryClient}>
    <SessionProvider
      initialSession={session === "restore" ? undefined : session}
      onEnd={onEnd}
    >
      {children}
    </SessionProvider>
  </QueryClientProvider>
);
