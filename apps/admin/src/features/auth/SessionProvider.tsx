import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api.ts";
import { createAuthClient } from "./auth-client.ts";
import { SessionContext } from "./session-context.ts";
import type {
  Session,
  SessionActions,
  SessionValue,
} from "./session-context.ts";
import { createSessionManager } from "./session-manager.ts";

interface SessionProviderProps {
  children: ReactNode;
  /** After the session ends: App.tsx forgets every cached query. */
  onEnd?: () => void;
  /**
   * Start with this session instead of restoring one from the cookie
   * (tests and stories): `null` renders a logged-out visitor at once and
   * sends no request. Leave it out in the app. Read once, when the
   * provider mounts.
   */
  initialSession?: Session | null;
}

type SessionState =
  | { status: "restoring"; session: null }
  | { status: "anonymous"; session: null }
  | { status: "authenticated"; session: Session };

/**
 * Holds the in-memory session for everything below it. The storefront's
 * provider (Bab 10), without the guest-cart hook.
 *
 * It starts "restoring" and asks the API, once, for a new access token
 * with the refresh cookie (the browser sends it; no script can read it).
 * A reload therefore keeps the seller logged in, without the token ever
 * being saved where a script could find it.
 */
export function SessionProvider({
  children,
  onEnd,
  initialSession,
}: SessionProviderProps) {
  const [state, setState] = useState<SessionState>(() => {
    if (initialSession === undefined) {
      return { status: "restoring", session: null };
    }
    return initialSession === null
      ? { status: "anonymous", session: null }
      : { status: "authenticated", session: initialSession };
  });

  // One manager per provider, created on the first render.
  const [manager] = useState(() =>
    createSessionManager({
      api,
      onChange: (session) => {
        setState(
          session === null
            ? { status: "anonymous", session: null }
            : { status: "authenticated", session },
        );
      },
      onEnd,
      initialSession,
    }),
  );

  // Restore once at start-up. In development StrictMode runs this effect
  // twice; restore() returns the same promise the second time, so the
  // cookie is sent once (a second refresh with it would be a reuse).
  useEffect(() => {
    void manager.restore();
  }, [manager]);

  // The functions never change, so a component that only uses them never
  // renders again because of the session.
  const actions = useMemo(
    (): SessionActions => ({
      login: manager.login,
      logout: manager.logout,
      ready: manager.restore,
      setSession: manager.setSession,
      getSession: manager.getSession,
      getAccessToken: manager.getAccessToken,
      authApi: createAuthClient(api, manager),
      tokens: {
        ensureFreshToken: manager.ensureFreshToken,
        refreshAfterUnauthorized: manager.refreshAfterUnauthorized,
        refreshAfterForbidden: manager.refreshAfterForbidden,
      },
    }),
    [manager],
  );

  const value = useMemo(
    (): SessionValue => ({ ...state, ...actions }),
    [state, actions],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
