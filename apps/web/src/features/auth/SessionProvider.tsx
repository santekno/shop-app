import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SessionContext } from "./session-context.ts";
import type { Session, SessionValue } from "./session-context.ts";

/**
 * Holds the in-memory session for everything below it: the header, the
 * auth pages and, from artikel 13, every request that needs a login.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  // A copy of the token that code running after a render can read
  // (getAccessToken). setSession updates it at once, where the state only
  // changes with the next render.
  const accessToken = useRef<string | null>(null);

  const setSession = useCallback((next: Session | null) => {
    accessToken.current = next?.accessToken ?? null;
    setSessionState(next);
  }, []);
  const getAccessToken = useCallback(() => accessToken.current, []);

  // One object per session: a component reading the context renders
  // again when someone logs in or out, not whenever this provider renders.
  // The functions in it never change.
  const value = useMemo(
    (): SessionValue =>
      session === null
        ? { status: "anonymous", session, setSession, getAccessToken }
        : { status: "authenticated", session, setSession, getAccessToken },
    [session, setSession, getAccessToken],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}
