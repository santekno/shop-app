import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchMock,
  product,
  productsResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import type { ProductListFilters } from "../api/queries.ts";
import { useProductList } from "./useProductList.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/** Two pages for kaos (cursor c2), one for anything else. */
const servePages = () => {
  fetchMock.mockImplementation((input) => {
    const params = requestUrl(input).searchParams;
    if (params.get("category") !== "kaos") {
      return Promise.resolve(productsResponse([product("lain")], null));
    }
    return Promise.resolve(
      params.get("cursor") === "c2"
        ? productsResponse([product("b")], null)
        : productsResponse([product("a")], "c2"),
    );
  });
};

const queries = () =>
  fetchMock.mock.calls.map(([input]) => requestUrl(input).search);

const slugs = (products: readonly { slug: string }[]) =>
  products.map((p) => p.slug);

const render = (
  filters: ProductListFilters,
  client = createTestQueryClient(),
) =>
  renderHook((props: ProductListFilters) => useProductList(props), {
    initialProps: filters,
    wrapper: hookWrapper(client),
  });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useProductList", () => {
  it("loads the first page and offers the next one", async () => {
    servePages();
    const { result } = render({ category: "kaos", limit: 12 });

    expect(result.current.products).toEqual([]);
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(slugs(result.current.products)).toEqual(["a"]);
    expect(result.current.hasNextPage).toBe(true);
    expect(queries()).toEqual(["?category=kaos&limit=12"]);
  });

  it("appends the next page and keeps the products already shown", async () => {
    servePages();
    const { result } = render({ category: "kaos", limit: 12 });
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    const [first] = result.current.products;

    act(() => {
      void result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(slugs(result.current.products)).toEqual(["a", "b"]);
    });
    expect(result.current.products[0]).toBe(first);
    expect(result.current.hasNextPage).toBe(false);
    expect(queries()).toEqual([
      "?category=kaos&limit=12",
      "?category=kaos&limit=12&cursor=c2",
    ]);
  });

  it("keeps each set of filters as its own list", async () => {
    servePages();
    const client = createTestQueryClient();
    const { result, rerender } = render(
      { category: "kaos", limit: 12 },
      client,
    );
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    rerender({ category: "kemeja", limit: 12 });
    await waitFor(() => {
      expect(slugs(result.current.products)).toEqual(["lain"]);
    });
    rerender({ category: "kaos", limit: 12 });

    // Back to kaos: its list comes from the cache, fetched once.
    expect(slugs(result.current.products)).toEqual(["a"]);
    expect(queries()).toEqual([
      "?category=kaos&limit=12",
      "?category=kemeja&limit=12",
    ]);
  });

  it("does not refetch for a new filters object with the same values", async () => {
    servePages();
    const { result, rerender } = render({ category: "kaos", limit: 12 });
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    rerender({ category: "kaos", limit: 12 });

    expect(queries()).toHaveLength(1);
  });
});
