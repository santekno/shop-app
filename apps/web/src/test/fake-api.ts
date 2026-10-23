// A stand-in for "@/lib/api.ts" in component and hook tests:
//
//   vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
//
// It is the real client from @goshop/shared, so request building, error
// mapping and cancelling all run for real; only the network is fake, through
// the client's injectable `fetch`. No retries, so a failure shows at once
// (src/lib/api.test.ts covers the storefront's retry settings).
import { createApiClient } from "@goshop/shared";
import type { Category } from "@goshop/shared";
import { vi } from "vitest";

export const API_URL = "http://api.test";

export const fetchMock = vi.fn<typeof fetch>();

export const api = createApiClient({
  baseUrl: API_URL,
  fetch: fetchMock,
  retries: 0,
});

/** The body of GET /v1/categories. */
export const categoriesResponse = (categories: Category[]) =>
  Response.json({ data: categories });

/** An API error response, optionally with an X-Request-ID. */
export const errorResponse = (
  status: number,
  code: string,
  requestId?: string,
) =>
  Response.json(
    { error: { code, message: "boom" } },
    {
      status,
      headers: requestId === undefined ? {} : { "X-Request-ID": requestId },
    },
  );

/** A promise and the functions that settle it, for answering a request later. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const category = (
  id: string,
  name: string,
  parentId: string | null = null,
): Category => ({ id, slug: name.toLowerCase(), name, parent_id: parentId });
