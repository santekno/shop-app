import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  LoginRequest,
  RegisterRequest,
  TokenPair,
  TokenPairDetail,
  User,
  UserDetail,
  WebSession,
  WebSessionDetail,
} from "./types.ts";

/**
 * POST /v1/auth/register: creates a buyer account and returns it. It
 * does not log in: call `login` next. Fails with VALIDATION_FAILED (one
 * entry per field in `details`), EMAIL_TAKEN, or RATE_LIMITED (10 per
 * hour per IP).
 */
export const register = async (
  api: ApiClient,
  body: RegisterRequest,
  { signal }: EndpointOptions = {},
): Promise<User> => {
  const response = await api.request<UserDetail>("/v1/auth/register", {
    method: "POST",
    body,
    signal,
  });
  return response.data;
};

/**
 * POST /v1/auth/login: a short-lived access token, a refresh token and
 * the account. Every wrong email or password is INVALID_CREDENTIALS, so
 * the answer never tells whether an email has an account.
 */
export const login = async (
  api: ApiClient,
  body: LoginRequest,
  { signal }: EndpointOptions = {},
): Promise<TokenPair> => {
  const response = await api.request<TokenPairDetail>("/v1/auth/login", {
    method: "POST",
    body,
    signal,
  });
  return response.data;
};

/*
 * The web session (Bab 10, ADR 0008). A browser must not keep a refresh
 * token where page scripts can read it, so the API hands it over in an
 * httpOnly cookie, scoped to /v1/auth/web: the browser stores it, sends it
 * back to these three endpoints by itself, and no JavaScript (ours or an
 * injected script) can read it. The access token comes in the body, and
 * the caller keeps it in memory only.
 *
 * Every call here, and nothing else in the client:
 *
 * - sends `credentials: "include"`, so the browser attaches and stores the
 *   cookie on a cross-origin request (the storefront and the API are on
 *   different ports or subdomains). Every other request keeps fetch's
 *   default, so no other endpoint ever sees a cookie;
 * - sends `X-GoShop-Client` with the app's name. A custom header needs a
 *   CORS preflight, which the API answers only for its configured origins:
 *   a page on any other origin cannot make these calls with the user's
 *   cookie (CSRF). The name also picks the cookie (Bab 12): `web` (the
 *   storefront, the default) uses `goshop_refresh`, `admin` (the dashboard)
 *   `goshop_admin_refresh`. Both apps talk to one API host, and a cookie
 *   belongs to that host, so with one name a login to either app would
 *   replace the other's session.
 *
 * The mobile app keeps login/refresh with the refresh token in the body.
 */

/** Which app a web session belongs to: the storefront or the dashboard. */
export type WebClient = "web" | "admin";

/** Options of the three web session calls: the signal, and the app. */
export interface WebSessionOptions extends EndpointOptions {
  /** The app asking; picks the session cookie. Default `"web"`. */
  client?: WebClient;
}

/** The header a web session call of `client` carries. */
export const webClientHeaders = (
  client: WebClient = "web",
): Readonly<Record<string, string>> => ({ "X-GoShop-Client": client });

/** The storefront's header: `X-GoShop-Client: web`. */
export const WEB_CLIENT_HEADERS: Readonly<Record<string, string>> =
  webClientHeaders("web");

/**
 * Longer than the API's own request timeout (15 s). A refresh rotates the
 * cookie on the server: a client that gave up first would keep the old
 * token while the server has already replaced it, and its next refresh
 * would look like a stolen token being reused (the whole session is then
 * revoked). Waiting longer than the server lets the answer, and its
 * Set-Cookie, always arrive.
 */
const WEB_SESSION_TIMEOUT_MS = 20_000;

const webSessionRequest = (client: WebClient = "web") =>
  ({
    method: "POST",
    headers: webClientHeaders(client),
    credentials: "include",
    timeoutMs: WEB_SESSION_TIMEOUT_MS,
  }) as const;

/**
 * POST /v1/auth/web/login: the access token and the account in the body,
 * the refresh token in the httpOnly cookie. Fails like `login`
 * (INVALID_CREDENTIALS, VALIDATION_FAILED, RATE_LIMITED), and with
 * FORBIDDEN when this page's origin is not one the API allows.
 */
export const webLogin = async (
  api: ApiClient,
  body: LoginRequest,
  { signal, client }: WebSessionOptions = {},
): Promise<WebSession> => {
  const response = await api.request<WebSessionDetail>("/v1/auth/web/login", {
    ...webSessionRequest(client),
    body,
    signal,
  });
  return response.data;
};

/**
 * POST /v1/auth/web/refresh: a new access token for the cookie's session,
 * and a rotated cookie. `null` when the browser sent no cookie (204: there
 * is no session to restore). A refused cookie throws 401 TOKEN_INVALID,
 * TOKEN_EXPIRED or UNAUTHORIZED, and the API clears it; RATE_LIMITED and
 * server errors leave it, because it may still be good.
 *
 * Never call it twice at once, in any tab: two refreshes with the same
 * cookie look like a stolen token being reused, and the API ends the
 * session. Each app serialises it (refresh-lock.ts in apps/web and
 * apps/admin); the two apps' cookies are separate, so they need not wait
 * for each other.
 */
export const webRefresh = async (
  api: ApiClient,
  { signal, client }: WebSessionOptions = {},
): Promise<WebSession | null> => {
  const response = await api.request<WebSessionDetail | undefined>(
    "/v1/auth/web/refresh",
    { ...webSessionRequest(client), signal },
  );
  return response?.data ?? null;
};

/**
 * POST /v1/auth/web/logout: ends the cookie's session on the server (its
 * refresh token and every access token of it stop working) and clears the
 * cookie. Succeeds with or without a cookie. Throws INTERNAL_ERROR when
 * revoking failed; the cookie is then kept, so call it again.
 */
export const webLogout = async (
  api: ApiClient,
  { signal, client }: WebSessionOptions = {},
): Promise<void> => {
  await api.request<undefined>("/v1/auth/web/logout", {
    ...webSessionRequest(client),
    signal,
  });
};
