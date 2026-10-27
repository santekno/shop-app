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
}

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
}: SessionManagerOptions) => {
  let current: Session | null = null;
  let refreshing: Promise<Session | null> | null = null;
  let restoring: Promise<void> | null = null;

  const publish = (session: Session | null) => {
    current = session;
    onChange(session);
  };

  /** A new session from a login or a restore: merge, then publish. */
  const start = async (web: WebSession): Promise<Session> => {
    const session = toSession(web);
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
        const session = toSession(web);
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
      publish(session);
    },

    refresh,

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
