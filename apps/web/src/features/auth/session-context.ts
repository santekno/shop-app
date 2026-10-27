import { createContext, useContext } from "react";
import type { User } from "@goshop/shared";

/** Who is logged in, kept in memory only. */
export interface Session {
  user: User;
  /** The short-lived JWT from POST /v1/auth/login (15 minutes). */
  accessToken: string;
}

export interface SessionValue {
  session: Session | null;
  setSession: (session: Session | null) => void;
}

/** null outside <SessionProvider>: useSession turns that into an error. */
export const SessionContext = createContext<SessionValue | null>(null);

/**
 * The logged-in user, from the nearest <SessionProvider>.
 *
 * Bab 9 keeps the minimum: the account and the access token, in React
 * state, never in localStorage (any script injected into the page could
 * read it there; ADR 0005). The refresh token is not kept at all. So a
 * reload logs the buyer out, and nothing refreshes the access token
 * when it expires; no request sends it yet either.
 *
 * Bab 10 builds the real thing: an auth store, the access token sent on
 * every request that needs it, a refresh before it expires (one at a
 * time, as the contract asks), logout through POST /v1/auth/logout, the
 * guest cart merged into the user's after login, and pages that need a
 * login.
 */
export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
};
