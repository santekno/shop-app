import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  LoginRequest,
  RegisterRequest,
  TokenPair,
  TokenPairDetail,
  User,
  UserDetail,
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
