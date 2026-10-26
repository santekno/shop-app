import { ApiError } from "@goshop/shared";
import {
  act,
  render as renderUi,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  product,
  productsResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { ProductGrid } from "../components/ProductGrid.tsx";
import { useProducts } from "./useProducts.ts";
import type { ProductFilters } from "./useProducts.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/**
 * Every request waits for the test to answer it. calls[n] is the nth
 * request: its query string, its signal and a function that answers it.
 */
const answerLater = () => {
  const calls: {
    query: string;
    signal: AbortSignal | null | undefined;
    answer: (response: Response) => void;
  }[] = [];
  fetchMock.mockImplementation((input, init) => {
    const response = deferred<Response>();
    calls.push({
      query: requestUrl(input).search,
      signal: init?.signal,
      answer: response.resolve,
    });
    return response.promise;
  });
  return calls;
};

/** Lets pending promise callbacks and React updates run. */
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const call = (calls: ReturnType<typeof answerLater>, n: number) => {
  const found = calls[n];
  if (!found) throw new Error(`request ${n} was not sent`);
  return found;
};

const render = (filters: ProductFilters = { limit: 12 }) =>
  renderHook((props: ProductFilters) => useProducts(props), {
    initialProps: filters,
  });

const slugs = (products: readonly { slug: string }[]) =>
  products.map((p) => p.slug);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useProducts", () => {
  it("loads the first page without a cursor", async () => {
    const calls = answerLater();
    const { result } = render();

    expect(result.current).toMatchObject({
      products: [],
      phase: "loading",
      error: undefined,
      hasMore: false,
    });
    expect(call(calls, 0).query).toBe("?limit=12");

    call(calls, 0).answer(productsResponse([product("a"), product("b")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("appends the next page with loadMore and keeps the loaded products' identity", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a"), product("b")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    const firstPage = result.current.products;

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.phase).toBe("loading");
    expect(result.current.products).toBe(firstPage);
    expect(call(calls, 1).query).toBe("?limit=12&cursor=c2");
    call(calls, 1).answer(productsResponse([product("c")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["a", "b", "c"]);
    expect(result.current.products[0]).toBe(firstPage[0]);
    expect(result.current.products[1]).toBe(firstPage[1]);
    expect(result.current.hasMore).toBe(false);
  });

  it("does nothing on loadMore while a page is loading", async () => {
    const calls = answerLater();
    const { result } = render();

    act(() => {
      result.current.loadMore();
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(result.current.phase).toBe("loading");
  });

  it("does nothing on loadMore after the last page", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    act(() => {
      result.current.loadMore();
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(result.current.phase).toBe("ready");
  });

  it("does nothing on loadMore after an error; retry is the way on", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });
    call(calls, 1).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    act(() => {
      result.current.loadMore();
    });
    await flush();

    expect(calls).toHaveLength(2);
    expect(result.current.phase).toBe("error");
  });

  it("reports a first-page error with no products, and retry asks again", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(errorResponse(500, "INTERNAL_ERROR", "req-1"));
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({ requestId: "req-1" });

    act(() => {
      result.current.retry();
    });

    expect(result.current.phase).toBe("loading");
    expect(result.current.error).toBeUndefined();
    expect(call(calls, 1).query).toBe("?limit=12");
    call(calls, 1).answer(productsResponse([product("a")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["a"]);
  });

  it("keeps the loaded products on a later-page error, and retry asks for the same page", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });
    call(calls, 1).answer(errorResponse(503, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    expect(slugs(result.current.products)).toEqual(["a"]);
    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.retry();
    });
    expect(call(calls, 2).query).toBe("?limit=12&cursor=c2");
    call(calls, 2).answer(productsResponse([product("b")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["a", "b"]);
  });

  it("does nothing on retry when there is no error", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    act(() => {
      result.current.retry();
    });
    await flush();

    expect(calls).toHaveLength(1);
    expect(result.current.phase).toBe("ready");
  });

  it("treats an empty page with a cursor as not the end", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    expect(result.current.products).toEqual([]);
    expect(result.current.hasMore).toBe(true);
    act(() => {
      result.current.loadMore();
    });
    expect(call(calls, 1).query).toBe("?limit=12&cursor=c2");
  });

  it("takes hasMore from next_cursor only, not from the page size", async () => {
    const calls = answerLater();
    const { result } = render({ limit: 2 });
    // A full page that is the last one.
    call(calls, 0).answer(productsResponse([product("a"), product("b")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(result.current.hasMore).toBe(false);
  });

  it("aborts the request in flight on unmount", () => {
    const calls = answerLater();
    const { unmount } = render();
    expect(call(calls, 0).signal?.aborted).toBe(false);

    unmount();

    expect(call(calls, 0).signal?.aborted).toBe(true);
  });

  it("works under StrictMode's double mount", async () => {
    const calls = answerLater();
    const { result } = renderHook(() => useProducts({ limit: 12 }), {
      wrapper: StrictMode,
    });
    expect(calls).toHaveLength(2);
    expect(call(calls, 0).signal?.aborted).toBe(true);

    call(calls, 1).answer(productsResponse([product("new")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    call(calls, 0).answer(productsResponse([product("old")], null));
    await flush();

    expect(slugs(result.current.products)).toEqual(["new"]);
  });

  it("does not refetch for a new filters object with the same values", async () => {
    const calls = answerLater();
    const { rerender } = render({ limit: 12 });

    rerender({ limit: 12 });
    await flush();

    expect(calls).toHaveLength(1);
  });

  it("starts a new list for new filters: empty, loading, no cursor", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ category: "kaos", limit: 12 });
    call(calls, 0).answer(productsResponse([product("kaos-a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    rerender({ category: "kemeja", limit: 12 });

    expect(result.current).toMatchObject({
      products: [],
      phase: "loading",
      hasMore: false,
    });
    expect(call(calls, 1).query).toBe("?category=kemeja&limit=12");
    call(calls, 1).answer(productsResponse([product("kemeja-a")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["kemeja-a"]);
  });

  it("ignores a late answer for the old filters", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ category: "kaos", limit: 12 });
    call(calls, 0).answer(productsResponse([product("kaos-a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });

    rerender({ sort: "price_asc", limit: 12 });
    expect(call(calls, 1).signal?.aborted).toBe(true);
    call(calls, 1).answer(productsResponse([product("kaos-b")], "c3"));
    await flush();

    expect(result.current).toMatchObject({ products: [], phase: "loading" });
    call(calls, 2).answer(productsResponse([product("murah")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["murah"]);
  });

  it("ignores a late error for the old filters", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ category: "kaos" });

    rerender({ category: "kemeja" });
    call(calls, 0).answer(errorResponse(500, "INTERNAL_ERROR"));
    await flush();

    expect(result.current.phase).toBe("loading");
    expect(result.current.error).toBeUndefined();
  });

  it("ignores late answers from an earlier visit when the filters come back", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ category: "kaos" });
    rerender({ category: "kemeja" });
    rerender({ category: "kaos" });
    expect(calls.map((c) => c.signal?.aborted)).toEqual([true, true, false]);

    // The first, aborted kaos request fails late, then its success arrives:
    // neither may land while the current kaos request is still pending.
    call(calls, 0).answer(errorResponse(500, "INTERNAL_ERROR"));
    await flush();
    expect(result.current).toMatchObject({ phase: "loading", products: [] });

    call(calls, 2).answer(productsResponse([product("kaos-a")], null));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["kaos-a"]);
  });

  it("keeps loadMore and retry the same functions until the filters change", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ limit: 12 });
    const { loadMore, retry } = result.current;
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    rerender({ limit: 12 });

    expect(result.current.loadMore).toBe(loadMore);
    expect(result.current.retry).toBe(retry);

    rerender({ limit: 24 });
    expect(result.current.loadMore).not.toBe(loadMore);
    expect(result.current.retry).not.toBe(retry);
  });

  it("starts from page 1 again when earlier filters come back (A, B, A), with no stale cursor", async () => {
    // Answers follow the query, as the API's would: kaos has two pages,
    // kemeja never answers.
    const queries: string[] = [];
    fetchMock.mockImplementation((input) => {
      const url = requestUrl(input);
      queries.push(url.search);
      const params = url.searchParams;
      if (params.get("category") !== "kaos")
        return new Promise(() => undefined);
      return Promise.resolve(
        params.get("cursor") === "c2"
          ? productsResponse([product("b")], null)
          : productsResponse([product("a")], "c2"),
      );
    });
    const { result, rerender } = render({ category: "kaos", limit: 12 });
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(slugs(result.current.products)).toEqual(["a", "b"]);
    });

    rerender({ category: "kemeja", limit: 12 });
    rerender({ category: "kaos", limit: 12 });

    expect(result.current).toMatchObject({
      products: [],
      phase: "loading",
      hasMore: false,
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(slugs(result.current.products)).toEqual(["a"]);
    expect(result.current.hasMore).toBe(true);
    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false);
    });

    expect(slugs(result.current.products)).toEqual(["a", "b"]);
    expect(queries).toEqual([
      "?category=kaos&limit=12",
      "?category=kaos&limit=12&cursor=c2",
      "?category=kemeja&limit=12",
      "?category=kaos&limit=12",
      "?category=kaos&limit=12&cursor=c2",
    ]);
  });

  it("renders A, B, A without a duplicate key in the grid", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fetchMock.mockImplementation((input) => {
      const params = requestUrl(input).searchParams;
      if (params.get("category") !== "kaos")
        return new Promise(() => undefined);
      return Promise.resolve(
        params.get("cursor") === "c2"
          ? productsResponse([product("b")], null)
          : productsResponse([product("a")], "c2"),
      );
    });
    let loadMore: () => void = () => undefined;
    function Catalog({ category }: { category: string }) {
      const list = useProducts({ category, limit: 12 });
      loadMore = list.loadMore;
      return <ProductGrid products={list.products} onSelectProduct={vi.fn()} />;
    }
    const view = renderUi(<Catalog category="kaos" />);
    await screen.findByText("Produk a");
    act(() => {
      loadMore();
    });
    await screen.findByText("Produk b");

    view.rerender(<Catalog category="kemeja" />);
    view.rerender(<Catalog category="kaos" />);
    await screen.findByText("Produk a");
    act(() => {
      loadMore();
    });
    await screen.findByText("Produk b");
    await flush();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      consoleError.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes("same key")),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("ignores loadMore and retry from a render with other filters", async () => {
    const calls = answerLater();
    const { result, rerender } = render({ category: "kaos" });
    const stale = result.current;

    rerender({ category: "kemeja" });
    call(calls, 1).answer(productsResponse([product("kemeja-a")], "k2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      stale.loadMore();
    });
    await flush();
    expect(calls).toHaveLength(2);
    expect(result.current.phase).toBe("ready");

    act(() => {
      result.current.loadMore();
    });
    call(calls, 2).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    act(() => {
      stale.retry();
    });
    await flush();
    expect(calls).toHaveLength(3);
    expect(result.current.phase).toBe("error");
  });

  it("ends the list when next_cursor repeats the cursor just used", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });

    call(calls, 1).answer(productsResponse([product("b")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    expect(slugs(result.current.products)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(false);
    act(() => {
      result.current.loadMore();
    });
    await flush();
    expect(calls).toHaveLength(2);
    expect(result.current.phase).toBe("ready");
  });

  it("keeps going when the next cursor differs from the one just used", async () => {
    const calls = answerLater();
    const { result } = render();
    call(calls, 0).answer(productsResponse([product("a")], "c2"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    act(() => {
      result.current.loadMore();
    });

    call(calls, 1).answer(productsResponse([product("b")], "c3"));
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    expect(result.current.hasMore).toBe(true);
  });
});
