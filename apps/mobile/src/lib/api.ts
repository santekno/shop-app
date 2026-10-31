// The app's API client: the same createApiClient from @goshop/shared that
// apps/web and apps/admin use (src/lib/api.ts there), so every endpoint
// function of the package (listProducts, getProduct, login, …) accepts it.
import { createApiClient } from "@goshop/shared";
import type { ApiClient } from "@goshop/shared";
import { apiUrl } from "@/config/env";

/**
 * The guest client: every request without a token.
 *
 * - `credentials: "omit"`: the app never sends or stores a cookie. A
 *   browser's fetch already does that for a cross-origin API, so the web
 *   apps set nothing; Expo's fetch (the app's global fetch) defaults to
 *   "include" and keeps a native cookie jar, so here it is said out loud.
 *   The buyer's session is a bearer token from expo-secure-store (Bab 15),
 *   not the web's httpOnly refresh cookie.
 * - `timeoutMs: 10_000`, the client's default, twice the web's 5 s: a
 *   phone on a cellular network can take seconds to wake its radio and
 *   reach the API, and a request cut off just before its answer is one
 *   the buyer has to wait for again.
 * - `retries: 1`: a GET that failed on the network, timed out, or got
 *   502/503/504 is tried once more after 300 ms. With 10 s attempts a
 *   buyer facing an API that never answers waits 10 + 0.3 + 10 ≈ 20 s
 *   before seeing the error, about what the web's 3 × 5 s + 0.9 s gives.
 */
export const api = createApiClient({
  baseUrl: apiUrl,
  credentials: "omit",
  timeoutMs: 10_000,
  retries: 1,
});

/**
 * The client for the buyer's own endpoints (cart, orders, /v1/me). The seam
 * for Bab 15: login replaces this line with a client that adds
 * `Authorization: Bearer <token>` (the token read from expo-secure-store)
 * to every request, the same decorator apps/web builds in
 * features/auth/auth-client.ts. Until then there is no token, so it is the
 * guest client; a call that needs a buyer answers 401 UNAUTHORIZED.
 */
export const authApi: ApiClient = api;
