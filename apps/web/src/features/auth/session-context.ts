import { createContext, useContext } from "react";
import type { User } from "@goshop/shared";

/** Who is logged in, kept in memory only. */
export interface Session {
  user: User;
  /** The short-lived JWT from POST /v1/auth/login (15 minutes). */
  accessToken: string;
}

/**
 * Whether someone is logged in. Artikel 12 adds "restoring": at start-up
 * the storefront asks the API for a new access token with the refresh
 * cookie, and the header must not show "Masuk" while that is in flight.
 */
export type SessionStatus = "anonymous" | "authenticated";

/**
 * What useSession returns. A discriminated union, like Bab 7's
 * AsyncState: checking `status` tells TypeScript whether `session` is
 * there, so `status === "authenticated"` gives a Session, never null.
 */
export type SessionValue = (
  | { status: "anonymous"; session: null }
  | { status: "authenticated"; session: Session }
) &
  SessionActions;

/** What useSession offers besides the session itself; it never changes. */
export interface SessionActions {
  setSession: (session: Session | null) => void;
  /**
   * The access token as it is right now, for code that runs outside a
   * render (a request made by a mutation or a query function). It reads a
   * ref, so a component that only sends requests does not have to render
   * again each time the token is refreshed.
   */
  getAccessToken: () => string | null;
}

/** null outside <SessionProvider>: useSession turns that into an error. */
export const SessionContext = createContext<SessionValue | null>(null);

/**
 * The logged-in user, from the nearest <SessionProvider>.
 *
 * React context, not a store like the cart's (artikel 08 and 11):
 *
 * - the session changes rarely (a login, a logout), so the renders a
 *   context causes in every reader do not matter;
 * - a provider is a scope: a test, or a story of one component, wraps the
 *   tree in a provider with the session it needs, and nothing leaks from
 *   one test into the next;
 * - from artikel 12 the provider also owns the session's lifecycle (the
 *   refresh at start-up, one refresh at a time before the token expires),
 *   which is component work: effects that start and clean up with the app.
 *
 * Everything stays in memory, never in localStorage (any script injected
 * into the page could read it there; ADR 0005). Until artikel 12 a reload
 * still logs the buyer out; artikel 12 keeps the refresh token in an
 * HttpOnly cookie that page scripts cannot read, and restores the session
 * from it.
 */
export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
};
