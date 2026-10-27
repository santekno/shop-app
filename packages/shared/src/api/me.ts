import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type { User, UserDetail } from "./types.ts";

/**
 * GET /v1/me: the logged-in user's own account. Needs a client that sends
 * the access token; without one, or with an expired or revoked one, it
 * throws 401 UNAUTHORIZED (the API does not tell an expired token from a
 * bad one: refresh once, then log in again).
 */
export const getMe = async (
  api: ApiClient,
  { signal }: EndpointOptions = {},
): Promise<User> => {
  const response = await api.request<UserDetail>("/v1/me", { signal });
  return response.data;
};
