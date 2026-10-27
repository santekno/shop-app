import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ApiClient } from "@goshop/shared";
import { api } from "@/lib/api.ts";
import { withAccessToken } from "./auth-client.ts";
import { SessionContext } from "./session-context.ts";
import type {
  Session,
  SessionActions,
  SessionValue,
} from "./session-context.ts";
import { createSessionManager } from "./session-manager.ts";

interface SessionProviderProps {
  children: ReactNode;
  /**
   * After a login or a restore, before the session is shown: App.tsx
   * merges the guest cart here. Read once, when the provider mounts.
   */
  onStart?: (client: ApiClient, session: Session) => Promise<void>;
  /** After the session ends: App.tsx forgets the user's cached data. */
  onEnd?: () => void;
}

type SessionState =
  | { status: "restoring"; session: null }
  | { status: "anonymous"; session: null }
  | { status: "authenticated"; session: Session };

/**
 * Holds the in-memory session for everything below it: the header, the
 * auth pages and every request made as the logged-in user.
 *
 * It starts "restoring" and asks the API, once, for a new access token
 * with the refresh cookie (the browser sends it; no script can read it).
 * A reload therefore keeps the buyer logged in, without the token ever
 * being saved where a script could find it.
 *
 * The auth feature knows nothing about the cart: what has to happen to
 * the cart when a session starts or ends comes in as props (App.tsx).
 */
export function SessionProvider({
  children,
  onStart,
  onEnd,
}: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({
    status: "restoring",
    session: null,
  });

  // One manager per provider, created on the first render (useState's
  // initializer runs once; a ref would also work). It calls setState,
  // which React keeps the same across renders.
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
      onStart,
      onEnd,
    }),
  );

  // Restore once at start-up. In development StrictMode runs this effect
  // twice; restore() returns the same promise the second time, so the
  // cookie is sent once (a second refresh with it would be a reuse).
  useEffect(() => {
    void manager.restore();
  }, [manager]);

  // The functions never change, so a component that only uses them
  // never renders again because of the session.
  const actions = useMemo(
    (): SessionActions => ({
      login: manager.login,
      logout: manager.logout,
      ready: manager.restore,
      setSession: manager.setSession,
      getSession: manager.getSession,
      getAccessToken: manager.getAccessToken,
      authApi: withAccessToken(api, manager.getAccessToken),
    }),
    [manager],
  );

  // One object per session: readers render again when someone logs in,
  // logs out or the token is refreshed, not whenever this provider does.
  const value = useMemo(
    (): SessionValue => ({ ...state, ...actions }),
    [state, actions],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
