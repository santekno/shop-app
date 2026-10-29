import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  product,
  productResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { getProductForPage } from "./server.ts";

// The server's API client is the real one (lib/server-api.ts); only the
// network is fake: Next.js' fetch is the global fetch, with `next` options.
const fetchMock = vi.fn<typeof fetch>();

type NextInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getProductForPage", () => {
  it("fetches the product by its slug, cached for a minute under its own tag", async () => {
    const kaos = product("kaos-polos");
    fetchMock.mockResolvedValue(productResponse(kaos));

    await expect(getProductForPage("kaos-polos")).resolves.toEqual(kaos);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/products/kaos-polos");
    expect((init as NextInit | undefined)?.next).toEqual({
      revalidate: 60,
      tags: ["products", "product:kaos-polos"],
    });
  });

  it("escapes the slug as one path segment", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND"));

    await getProductForPage("a/b?c");

    const [input] = fetchMock.mock.calls[0] ?? [];
    expect(input && requestUrl(input).pathname).toBe("/v1/products/a%2Fb%3Fc");
  });

  it("is null for NOT_FOUND: the page answers with its 404", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND"));

    await expect(getProductForPage("gone")).resolves.toBeNull();
  });

  it("throws any other error, so the page answers 500 and is retried later", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));

    await expect(getProductForPage("kaos")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
