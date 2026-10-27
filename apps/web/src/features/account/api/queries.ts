import { queryOptions } from "@tanstack/react-query";
import { getMe } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";

/**
 * The account's query keys. The user's id is in the key, like the cart's:
 * another user's account is another entry.
 *
 *   ["me"]          everything about the logged-in user (what a logout removes)
 *   ["me", userId]  GET /v1/me
 */
export const meKeys = {
  all: ["me"] as const,
  user: (userId: string) => [...meKeys.all, userId] as const,
};

/** GET /v1/me with `client`, which sends the access token. */
export const meQuery = (client: ApiClient, userId: string) =>
  queryOptions({
    queryKey: meKeys.user(userId),
    queryFn: ({ signal }) => getMe(client, { signal }),
  });
