import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  errorResponse,
  product,
  productsResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import {
  SITEMAP_PRODUCT_LIMIT,
  SITEMAP_REVALIDATE_SECONDS,
  getCategoriesForPage,
  listProductsForSitemap,
} from "./server.ts";

// The server's API client is the real one (lib/server-api.ts); only the
// network is fake: Next.js' fetch is the global fetch, with `next` options.
const fetchMock = vi.fn<typeof fetch>();

type NextInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

/** Each request: its path and query, and the data cache options it asked for. */
const requests = () =>
  fetchMock.mock.calls.map(([input, init]) => {
    const url = requestUrl(input);
    return {
      path: `${url.pathname}${url.search}`,
      next: (init as NextInit | undefined)?.next,
    };
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCategoriesForPage", () => {
  it("fetches the categories through the data cache for five minutes", async () => {
    const kaos = category("c1", "Kaos");
    fetchMock.mockResolvedValue(categoriesResponse([kaos]));

    await expect(getCategoriesForPage()).resolves.toEqual([kaos]);

    expect(requests()).toEqual([
      {
        path: "/v1/categories",
        next: { revalidate: 300, tags: ["categories"] },
      },
    ]);
  });

  it("is null when the API cannot answer, so the page still renders", async () => {
    fetchMock.mockResolvedValue(errorResponse(503, "UNAVAILABLE"));

    await expect(getCategoriesForPage()).resolves.toBeNull();
  });

  it("is null when the API cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(getCategoriesForPage()).resolves.toBeNull();
  });
});

describe("listProductsForSitemap", () => {
  it("walks every page, 100 at a time, following next_cursor until it is null", async () => {
    const a = product("a");
    const b = product("b");
    const c = product("c");
    fetchMock
      .mockResolvedValueOnce(productsResponse([a, b], "cur-2"))
      .mockResolvedValueOnce(productsResponse([c], null));

    await expect(listProductsForSitemap()).resolves.toEqual([a, b, c]);

    const cache = {
      revalidate: SITEMAP_REVALIDATE_SECONDS,
      tags: ["products", "sitemap"],
    };
    expect(SITEMAP_REVALIDATE_SECONDS).toBe(3_600);
    expect(requests()).toEqual([
      { path: "/v1/products?limit=100", next: cache },
      { path: "/v1/products?limit=100&cursor=cur-2", next: cache },
    ]);
  });

  it("stops when the API answers the same cursor twice", async () => {
    fetchMock
      .mockResolvedValueOnce(productsResponse([product("a")], "loop"))
      .mockResolvedValueOnce(productsResponse([product("b")], "loop"))
      .mockResolvedValue(productsResponse([product("never")], null));

    const products = await listProductsForSitemap();

    expect(products.map((p) => p.slug)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops when the API leads back to a cursor it gave before", async () => {
    fetchMock
      .mockResolvedValueOnce(productsResponse([product("a")], "A"))
      .mockResolvedValueOnce(productsResponse([product("b")], "B"))
      .mockResolvedValueOnce(productsResponse([product("c")], "A"))
      .mockResolvedValue(productsResponse([product("again")], "B"));

    const products = await listProductsForSitemap();

    expect(products.map((p) => p.slug)).toEqual(["a", "b", "c"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("is empty for an empty catalog", async () => {
    fetchMock.mockResolvedValue(productsResponse([], null));

    await expect(listProductsForSitemap()).resolves.toEqual([]);
  });

  it("stops at the sitemap's limit, with a warning to split it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // silenced
    });
    const page = Array.from({ length: 100 }, (_, i) =>
      product(`p${String(i)}`),
    );
    let n = 0;
    fetchMock.mockImplementation(() => {
      n += 1;
      return Promise.resolve(productsResponse(page, `cur-${String(n)}`));
    });

    const products = await listProductsForSitemap();

    expect(SITEMAP_PRODUCT_LIMIT).toBe(49_000);
    expect(products).toHaveLength(SITEMAP_PRODUCT_LIMIT);
    expect(fetchMock).toHaveBeenCalledTimes(SITEMAP_PRODUCT_LIMIT / 100);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("more than 49000 products");
  });

  it("cuts a page that runs past the limit at the limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      // silenced
    });
    // Pages that do not divide the limit (150 does not divide 49 000).
    const page = Array.from({ length: 150 }, (_, i) =>
      product(`p${String(i)}`),
    );
    let n = 0;
    fetchMock.mockImplementation(() => {
      n += 1;
      return Promise.resolve(productsResponse(page, `cur-${String(n)}`));
    });

    const products = await listProductsForSitemap();

    expect(fetchMock).toHaveBeenCalledTimes(327);
    expect(products).toHaveLength(SITEMAP_PRODUCT_LIMIT);
  });

  it("throws when a page fails: a sitemap missing products is worse than a retry", async () => {
    fetchMock
      .mockResolvedValueOnce(productsResponse([product("a")], "cur-2"))
      .mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));

    await expect(listProductsForSitemap()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
