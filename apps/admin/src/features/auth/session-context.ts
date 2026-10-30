import { createContext, useContext } from "react";
import type { ApiClient, LoginRequest, User } from "@goshop/shared";

/** Who is logged in, kept in memory only. */
export interface Session {
  /**
   * The account, `role` included, as POST /v1/auth/web/login or
   * /web/refresh returned it. Every refresh brings it again, so a role an
   * admin changes reaches the dashboard within one access-token lifetime.
   */
  user: User;
  /**
   * The short-lived JWT from POST /v1/auth/web/login or /web/refresh
   * (15 minutes). In memory only.
   */
  accessToken: string;
}

/**
 * Whether someone is logged in. "restoring" is the moment at start-up
 * while the dashboard asks the API for a new access token with the refresh
 * cookie: nobody knows yet, so a protected page waits instead of
 * redirecting to the login form.
 */
export type SessionStatus = "restoring" | "anonymous" | "authenticated";

/**
 * What useSession returns: a discriminated union, so checking `status`
 * tells TypeScript whether `session` is there.
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
   * the httpOnly cookie, the access token into memory. Rejects with the
   * API's error. Any role may log in; RequireStaff decides what a buyer
   * sees afterwards.
   */
  login: (credentials: LoginRequest) => Promise<Session>;
  /**
   * POST /v1/auth/web/logout, then forgets the session and every cached
   * query. Rejects, keeping the session, when the API could not confirm it.
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
   * access token to each one, refreshes the token shortly before it
   * expires, and refreshes and retries once after a 401 (createAuthClient).
   */
  authApi: ApiClient;
  /** The access token as it is right now, for code outside a render. */
  getAccessToken: () => string | null;
}

/** null outside <SessionProvider>: useSession turns that into an error. */
export const SessionContext = createContext<SessionValue | null>(null);

/**
 * The logged-in user, from the nearest <SessionProvider>. The same design
 * as the storefront's (Bab 10 artikel 11–14): context, because the session
 * changes rarely and a provider is a scope tests can set; the access token
 * in memory only, the refresh token in an HttpOnly cookie.
 */
export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
};

/**
 * The logged-in user, for components that only render under RequireStaff
 * (the dashboard's layout and pages), where a session always exists.
 * Throws otherwise: such a component rendered outside the guard is a bug.
 */
export const useSessionUser = (): User => {
  const { session } = useSession();
  if (session === null) {
    throw new Error("useSessionUser must be used under <RequireStaff>");
  }
  return session.user;
};
