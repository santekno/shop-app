import { createApiClient } from "@goshop/shared";
import { config } from "@/config.ts";

/**
 * The one API client of the storefront. GET requests are retried twice
 * (after 300 ms, then 600 ms) when the network fails, the attempt times
 * out, or the API answers 502/503/504; other errors are thrown at once.
 *
 * Each attempt gets 5 seconds, half the client's default. The timeout is
 * per attempt, so against an API that never answers a buyer waits for
 * three attempts plus two pauses before seeing the error:
 * 3 × 5 s + 0.3 s + 0.6 s ≈ 16 s (with 10 s it would be about 31 s).
 * The API allows itself 15 s (APP_REQUEST_TIMEOUT), so a GET slower than
 * 5 s is retried while the API may still be working on it: harmless for a
 * read, which is why only GET and HEAD are ever retried.
 */
export const api = createApiClient({
  baseUrl: config.apiUrl,
  timeoutMs: 5_000,
  retries: 2,
});
