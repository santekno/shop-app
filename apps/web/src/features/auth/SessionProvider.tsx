import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SessionContext } from "./session-context.ts";
import type { Session } from "./session-context.ts";

/** Holds the in-memory session for the header and the auth pages. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const value = useMemo(() => ({ session, setSession }), [session]);
  return <SessionContext value={value}>{children}</SessionContext>;
}
