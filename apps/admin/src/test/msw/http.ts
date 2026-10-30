// What every handler module shares: the API's address in tests, error
// bodies in the contract's shape, and a log of the requests sent.
import { HttpResponse } from "msw";
import type { ErrorBody, paths } from "@goshop/shared";
import { config } from "@/config.ts";
import { server } from "./server.ts";

/**
 * The API the dashboard talks to under Vitest: vite.config.ts empties
 * VITE_API_URL, so config.ts falls back to its development default.
 */
export const API_URL = config.apiUrl;

/**
 * The full URL of a path of the contract, in MSW's syntax: the contract's
 * `{id}` becomes MSW's `:id`. Only paths that exist in api/openapi.yaml
 * are accepted, so a renamed endpoint fails the type check here.
 */
export const apiUrl = (path: keyof paths): string =>
  `${API_URL}${path.replace(/\{(\w+)\}/g, ":$1")}`;

/** The API's error answer: `{ "error": { code, message, details } }`. */
export const errorResponse = (
  status: number,
  code: string,
  {
    details,
    requestId,
  }: { details?: Record<string, unknown>; requestId?: string } = {},
) =>
  HttpResponse.json<ErrorBody>(
    {
      error: {
        code,
        message: "boom",
        ...(details === undefined ? {} : { details }),
      },
    },
    {
      status,
      headers: requestId === undefined ? {} : { "X-Request-ID": requestId },
    },
  );

/** One request as a test reads it back. */
export interface SentRequest {
  method: string;
  url: URL;
  headers: Headers;
  /** The body parsed as JSON; rejects for a request without one. */
  json: () => Promise<unknown>;
}

/**
 * Records every request that reaches MSW from now on, in order:
 *
 *   const sent = recordRequests();
 *   … the code under test …
 *   expect(sent.map((r) => r.url.pathname)).toEqual(["/v1/admin/orders"]);
 *
 * The body is read from a clone, so the handler still gets the original.
 * vitest.setup.ts removes the listener after each test.
 */
export const recordRequests = (): SentRequest[] => {
  const sent: SentRequest[] = [];
  server.events.on("request:start", ({ request }) => {
    const copy = request.clone();
    sent.push({
      method: request.method,
      url: new URL(request.url),
      headers: new Headers(request.headers),
      json: () => copy.json(),
    });
  });
  return sent;
};
