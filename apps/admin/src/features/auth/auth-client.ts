// The storefront's interceptor (Bab 10 artikel 14, apps/web/src/features/
// auth/auth-client.ts), unchanged: the admin logs in through the same web
// session endpoints. Why it is a copy, not an import from @goshop/shared:
// apps/admin/README.md, artikel 01.
import { isApiError } from "@goshop/shared";
import type { ApiClient, RequestOptions } from "@goshop/shared";

/** `options` with `Authorization: Bearer <token>` added to its headers. */
export const withBearer = (
  options: RequestOptions,
  accessToken: string,
): RequestOptions => {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...options, headers };
};

/**
 * A client with the same shape as `api` (so every endpoint function of
 * @goshop/shared accepts it) that adds the access token `getAccessToken`
 * returns at the moment each request is sent. Without a token the request
 * goes out as it is, as a guest's.
 *
 * The token is read per request, not captured once: a request sent after a
 * refresh carries the new token.
 */
export const withAccessToken = (
  api: ApiClient,
  getAccessToken: () => string | null,
): ApiClient => ({
  request: <T>(path: string, options?: RequestOptions) => {
    const token = getAccessToken();
    return api.request<T>(
      path,
      token === null ? options : withBearer(options ?? {}, token),
    );
  },
});

/** What createAuthClient needs from the session (session-manager.ts). */
export interface TokenSource {
  /**
   * The token to send now, refreshed first when it is about to expire;
   * null for a guest (there never was a session). Rejects with 401
   * UNAUTHORIZED when there was a session and that refresh ended it.
   */
  ensureFreshToken: () => Promise<string | null>;
  /** After a 401 with `staleToken`: the token to retry with, or null. */
  refreshAfterUnauthorized: (staleToken: string) => Promise<string | null>;
}

/**
 * The refresh-token interceptor (artikel 14): a client with the same shape
 * as `api`, for every request made as the logged-in user.
 *
 * 1. Before sending, it asks for a fresh token. A token within its last
 *    30 seconds is replaced first (proactive refresh): the normal case
 *    never sees a 401, so no failed request and no red line in the
 *    console.
 * 2. If the API still answers 401 UNAUTHORIZED (the token expired anyway:
 *    a tab asleep in the background, a clock jump, the API restarted with
 *    another key, the session revoked), it refreshes once and sends the
 *    same request again, once. The API answers an expired access token
 *    with UNAUTHORIZED, never TOKEN_EXPIRED (that code is only about the
 *    refresh token), so any 401 to a request that carried a token counts.
 * 3. Many requests that fail together share one refresh: the session
 *    manager keeps a refresh on its way as a single promise, and a request
 *    whose token was already replaced by the time its 401 arrived just
 *    retries with the new one.
 * 4. When the refresh says the session is over (204, or 401 from the
 *    refresh endpoint), the session manager has already ended the session
 *    (and App.tsx dropped the user's cached data); the original 401
 *    is thrown, and a protected page redirects to /masuk. The proactive
 *    refresh in (1) ends the same way: ensureFreshToken rejects with 401
 *    UNAUTHORIZED and the request is not sent at all. It must not go out
 *    without a token: its caller chose the logged-in path, and the API
 *    would only answer 401 again.
 *
 * Retrying a POST is safe here: a 401 comes from the auth middleware,
 * before the handler runs, so nothing was done the first time. A second
 * 401 is not retried again; there is no loop.
 *
 * Without a session (there never was one) it sends the request as it is,
 * as a guest's.
 */
export const createAuthClient = (
  api: ApiClient,
  tokens: TokenSource,
): ApiClient => ({
  request: async <T>(path: string, options?: RequestOptions) => {
    // Rejects with 401 when the session ended just now (see 4).
    const token = await tokens.ensureFreshToken();
    if (token === null) return api.request<T>(path, options);
    try {
      return await api.request<T>(path, withBearer(options ?? {}, token));
    } catch (error) {
      if (!isApiError(error, "UNAUTHORIZED")) throw error;
      const fresh = await tokens.refreshAfterUnauthorized(token);
      if (fresh === null) throw error;
      return api.request<T>(path, withBearer(options ?? {}, fresh));
    }
  },
});
