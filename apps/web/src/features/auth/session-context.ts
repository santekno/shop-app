import { createContext, useContext } from "react";
import type { ApiClient, LoginRequest, User } from "@goshop/shared";

/** Who is logged in, kept in memory only. */
export interface Session {
  user: User;
  /**
   * The short-lived JWT from POST /v1/auth/web/login or /web/refresh
   * (15 minutes). In memory only.
   */
  accessToken: string;
}

/**
 * Whether someone is logged in. "restoring" (artikel 12) is the moment at
 * start-up while the storefront asks the API for a new access token with
 * the refresh cookie: nobody knows yet, so the header shows neither
 * "Masuk" nor a name, and a protected page waits instead of redirecting.
 */
export type SessionStatus = "restoring" | "anonymous" | "authenticated";

/**
 * What useSession returns. A discriminated union, like Bab 7's
 * AsyncState: checking `status` tells TypeScript whether `session` is
 * there, so `status === "authenticated"` gives a Session, never null.
 */
export type SessionValue = (
  | { status: "restoring"; session: null }
  | { status: "anonymous"; session: null }
  | { status: "authenticated"; session: Session }
) &
  SessionActions;

/** What useSession offers besides the session itself; it never changes. */
export interface SessionActions {
  /**
   * Logs in through POST /v1/auth/web/login: the refresh token goes into
   * the httpOnly cookie, the access token into memory, the guest cart into
   * the user's cart. Rejects with the API's error.
   */
  login: (credentials: LoginRequest) => Promise<Session>;
  /**
   * POST /v1/auth/web/logout, then forgets the session and the user's
   * cached data. Rejects, keeping the session, when the API could not
   * confirm it.
   */
  logout: () => Promise<void>;
  /** Resolves once the start-up restore has settled (status is known). */
  ready: () => Promise<void>;
  /** Replaces the session without asking the API (tests). */
  setSession: (session: Session | null) => void;
  /** The session as it is right now, for code outside a render. */
  getSession: () => Session | null;
  /**
   * The API client for requests made as the logged-in user: it adds the
   * access token to each one (and, from artikel 14, refreshes it). For a
   * guest it sends the request without a token.
   */
  authApi: ApiClient;
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
 * - the provider owns the session's lifecycle (the restore at start-up
 *   is an effect that starts with the app; session-manager.ts does the
 *   protocol).
 *
 * The access token stays in memory, never in localStorage or
 * sessionStorage (any script injected into the page could read it there;
 * ADR 0005). The refresh token is in an HttpOnly cookie that no script can
 * read, and a reload restores the session from it (artikel 12).
 */
export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
};
