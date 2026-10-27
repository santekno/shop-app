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
