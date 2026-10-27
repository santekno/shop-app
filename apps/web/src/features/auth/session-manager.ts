import { isApiError, webLogin, webLogout, webRefresh } from "@goshop/shared";
import type { ApiClient, LoginRequest, WebSession } from "@goshop/shared";
import { withAccessToken } from "./auth-client.ts";
import { withSessionLock } from "./refresh-lock.ts";
import type { Session } from "./session-context.ts";

/** What createSessionManager needs. */
export interface SessionManagerOptions {
  /** The storefront's API client (lib/api.ts), without any token. */
  api: ApiClient;
  /** Called with each new session, and with null when the session ends. */
  onChange: (session: Session | null) => void;
  /**
   * Runs after a login or a restore, before the session is published, with
   * a client that already sends the new access token. App.tsx merges the
   * guest cart here, so the header switches to the user's cart once, with
   * the guest's lines already in it. It must not throw: the login has
   * succeeded whatever happens to the cart.
   */
  onStart?: (client: ApiClient, session: Session) => Promise<void>;
  /** After the session ends: forget the user's cached data (App.tsx). */
  onEnd?: () => void;
  /** Serialises every cookie call across tabs; tests may pass their own. */
  lock?: <T>(task: () => Promise<T>) => Promise<T>;
  /** The clock, in milliseconds; tests may pass their own. */
  now?: () => number;
  /**
   * A session known from the start (tests and stories): `null` for a
   * guest. When given, `restore` asks the API nothing. Its expiry is
   * unknown, so it is never refreshed before a request, only after a 401.
   */
  initialSession?: Session | null;
}

/**
 * How early before it expires an access token is replaced (artikel 14):
 * 30 seconds, or half its lifetime when that is shorter (the API allows
 * APP_ACCESS_TOKEN_TTL down to 1 minute). Enough for a request to reach
 * the API before the token runs out, without refreshing much earlier than
 * needed (each refresh counts against the API's 60 per 15 minutes per IP).
 */
export const refreshMarginMs = (lifetimeMs: number): number =>
  Math.min(30_000, lifetimeMs / 2);

/** A refused refresh cookie: the session is over, the buyer logs in again. */
const endsSession = (error: unknown): boolean =>
  isApiError(error, "TOKEN_INVALID", "TOKEN_EXPIRED", "UNAUTHORIZED");

const toSession = (web: WebSession): Session => ({
  user: web.user,
  accessToken: web.access_token,
});

/**
 * The web session's protocol, without React: who is logged in, and the
 * three cookie calls. SessionProvider creates one and turns its changes
 * into React state.
 *
 * - The access token lives here, in memory, and nowhere else: never in
 *   localStorage or sessionStorage, where any script on the page could
 *   read it. A reload loses it; `restore` gets a new one from the cookie.
 * - The refresh token is never seen by this code at all: it is in the
 *   httpOnly cookie, which only the browser handles.
 * - Login, refresh and logout run inside withSessionLock, one at a time
 *   across every tab (refresh-lock.ts explains the reuse detection it
 *   avoids), and a refresh already on its way in this tab is shared
 *   rather than sent twice.
 */
export const createSessionManager = ({
  api,
  onChange,
  onStart,
  onEnd,
  lock = withSessionLock,
  now = Date.now,
  initialSession,
}: SessionManagerOptions) => {
  let current: Session | null = initialSession ?? null;
  // When the current access token should be replaced, in now()'s
  // milliseconds; null when unknown (a session set by setSession).
  let refreshAt: number | null = null;
  let refreshing: Promise<Session | null> | null = null;
  let restoring: Promise<void> | null =
    initialSession === undefined ? null : Promise.resolve();

  const publish = (session: Session | null) => {
    current = session;
    if (session === null) refreshAt = null;
    onChange(session);
  };

  /**
   * A token from the API, with the moment to replace it. `expires_in` is
   * relative (seconds from now), so the client's clock being wrong by
   * minutes does not matter; only the request's own latency does, and
   * the margin covers it.
   */
  const accept = (web: WebSession): Session => {
    const lifetimeMs = web.expires_in * 1000;
    refreshAt = now() + lifetimeMs - refreshMarginMs(lifetimeMs);
    return toSession(web);
  };

  /** A new session from a login or a restore: merge, then publish. */
  const start = async (web: WebSession): Promise<Session> => {
    const session = accept(web);
    await onStart?.(
      withAccessToken(api, () => session.accessToken),
      session,
    );
    publish(session);
    return session;
  };

  const end = () => {
    const wasLoggedIn = current !== null;
    publish(null);
    if (wasLoggedIn) onEnd?.();
  };

  /**
   * One refresh at a time. A second caller while one is on its way (two
   * requests that both need a new token, or StrictMode's second effect)
   * gets the same promise instead of sending the cookie again.
   *
   * Resolves to the new session, or to null when there is none any more:
   * no cookie (204) or a refused one (401, which also clears it). Other
   * failures (the network, 429, 500) reject and leave the session as it
   * is: the cookie may well still be good.
   */
  const refresh = (): Promise<Session | null> => {
    refreshing ??= lock(async () => {
      try {
        const web = await webRefresh(api);
        if (web === null) {
          end();
          return null;
        }
        const session = accept(web);
        publish(session);
        return session;
      } catch (error) {
        if (!endsSession(error)) throw error;
        end();
        return null;
      }
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  return {
    getSession: (): Session | null => current,
    getAccessToken: (): string | null => current?.accessToken ?? null,

    /** Replaces the session without asking the API (tests, mostly). */
    setSession: (session: Session | null) => {
      refreshAt = null;
      publish(session);
    },

    refresh,

    /**
     * The access token to send with a request now (artikel 14), or null
     * for a guest. A token about to expire is replaced first (proactive
     * refresh, shared by every request that asks at the same time), so the
     * request does not go out only to come back 401. When that refresh
     * fails for a reason that does not end the session (the network), the
     * current token is returned: it may still be good, and the 401 path
     * below is the second chance.
     */
    ensureFreshToken: async (): Promise<string | null> => {
      if (current === null) return null;
      const token = current.accessToken;
      if (refreshAt === null || now() < refreshAt) return token;
      try {
        return (await refresh())?.accessToken ?? null;
      } catch {
        // A failed refresh that did not end the session changed nothing.
        return token;
      }
    },

    /**
     * After a request sent with `staleToken` came back 401 (artikel 14):
     * the token to retry with, or null when the session is over (already
     * ended here: onEnd has run). If another request has refreshed since
     * this one was sent, its token is used without a second refresh;
     * otherwise this refreshes, sharing a refresh already on its way.
     * Other failures (the network, 429, 500) reject, and the session stays.
     */
    refreshAfterUnauthorized: async (
      staleToken: string,
    ): Promise<string | null> => {
      if (current !== null && current.accessToken !== staleToken) {
        return current.accessToken;
      }
      return (await refresh())?.accessToken ?? null;
    },

    /**
     * At start-up: ask for a new access token with the cookie, if the
     * browser has one. Runs once per manager; calling it again returns
     * the same promise. Never rejects: a failure (the API is down) leaves
     * the visitor anonymous, and the cookie in place for the next reload.
     */
    restore: (): Promise<void> => {
      restoring ??= lock(() => webRefresh(api))
        .then(async (web) => {
          if (web === null) publish(null);
          else await start(web);
        })
        .catch(() => {
          // 401: the API has cleared the cookie. Anything else: try again
          // on the next reload. Either way, a guest for now.
          publish(null);
        });
      return restoring;
    },

    /** Logs in through the web endpoint; the cookie is set by the answer. */
    login: async (credentials: LoginRequest): Promise<Session> => {
      const web = await lock(() => webLogin(api, credentials));
      return start(web);
    },

    /**
     * Ends the session on the server, then here. When the API cannot
     * confirm it (the network, a 500 that kept the cookie) this rejects and
     * the buyer stays logged in, rather than looking logged out while a
     * reload would bring the session back.
     */
    logout: async (): Promise<void> => {
      await lock(() => webLogout(api));
      end();
    },
  };
};

export type SessionManager = ReturnType<typeof createSessionManager>;
