import { describe, expect, it } from "@jest/globals";
import { act, waitFor } from "@testing-library/react-native";

import { apiError, deferred, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { renderHookWithProviders } from "@/test/render";
import { useProductList } from "./useProductList";

const filters = { sort: "newest" } as const;
const names = (products: { name: string }[]) => products.map((p) => p.name);
const cursors = () =>
  fakeApi
    .requests("GET", "/v1/products")
    .map((r) => r.url.searchParams.get("cursor"));

/** Two pages loaded: A, B, then C after cursor c1. */
const loadTwoPages = async () => {
  fakeApi.once("GET", "/v1/products", () =>
    json(productPage([product("A"), product("B")], "c1")),
  );
  fakeApi.once("GET", "/v1/products", () =>
    json(productPage([product("C")], null)),
  );
  const hook = await renderHookWithProviders(() => useProductList(filters));
  await waitFor(() => {
    expect(hook.result.current.status).toBe("success");
  });
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });
  // TanStack Query tells the component on the next task, not at once.
  await waitFor(() => {
    expect(hook.result.current.products).toHaveLength(3);
  });
  return hook;
};

describe("useProductList", () => {
  it("is empty and pending before the first page arrives", async () => {
    const answer = deferred();
    fakeApi.on("GET", "/v1/products", answer.handler);
    const { result } = await renderHookWithProviders(() =>
      useProductList(filters),
    );

    expect(result.current.products).toEqual([]);
    expect(result.current.status).toBe("pending");
    await act(async () => {
      answer.resolve(json(productPage([product("A")])));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(names(result.current.products)).toEqual(["A"]);
    });
  });

  it("flattens the pages in order, the next page asked for with the cursor", async () => {
    const { result } = await loadTwoPages();

    expect(names(result.current.products)).toEqual(["A", "B", "C"]);
    expect(result.current.hasNextPage).toBe(false);
    expect(cursors()).toEqual([null, "c1"]);
  });

  it("refresh keeps the first page only and fetches just that one again", async () => {
    const { result } = await loadTwoPages();
    fakeApi.once("GET", "/v1/products", () =>
      json(productPage([product("A2")], "c9")),
    );

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(names(result.current.products)).toEqual(["A2"]);
    });
    // One request, without a cursor: not a refetch of every page.
    expect(cursors()).toEqual([null, "c1", null]);
    expect(result.current.hasNextPage).toBe(true);
  });

  it("isRefreshing is true for the pull only, until its answer arrives", async () => {
    const { result } = await loadTwoPages();
    const answer = deferred();
    fakeApi.once("GET", "/v1/products", answer.handler);

    let refreshing: Promise<void> = Promise.resolve();
    await act(async () => {
      refreshing = result.current.refresh();
      await Promise.resolve();
    });
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      answer.resolve(json(productPage([product("A2")])));
      await refreshing;
    });
    expect(result.current.isRefreshing).toBe(false);
  });

  it("isRefreshing goes back to false when the pull fails; the error is in the query", async () => {
    const { result } = await loadTwoPages();
    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL", "r-1"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isRefreshing).toBe(false);
    await waitFor(() => {
      expect(result.current.isRefetchError).toBe(true);
    });
    expect(result.current.error).toMatchObject({
      code: "INTERNAL",
      requestId: "r-1",
    });
    // The first page stays on screen.
    expect(names(result.current.products)).toEqual(["A", "B"]);
  });

  it("isRefreshing stays false for a background refetch", async () => {
    const { result } = await loadTwoPages();
    const first = deferred();
    fakeApi.once("GET", "/v1/products", first.handler);
    fakeApi.once("GET", "/v1/products", () =>
      json(productPage([product("C")])),
    );

    let refetching: Promise<unknown> = Promise.resolve();
    await act(async () => {
      refetching = result.current.refetch();
      await Promise.resolve();
    });
    // The hook hands over isFetching, not isRefetching: with data on
    // screen the two are the same here.
    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      first.resolve(json(productPage([product("A")], "c1")));
      await refetching;
    });
  });

  it("keeps the same products array across a render with no new page", async () => {
    const hook = await loadTwoPages();
    const before = hook.result.current.products;

    // A render for any other reason (the screen's own state, a parent):
    // the list gets the same array, so it has nothing to redo.
    await hook.rerender(undefined);
    expect(hook.result.current.products).toBe(before);
    expect(names(hook.result.current.products)).toEqual(["A", "B", "C"]);
  });

  it("refresh before any data just fetches the first page", async () => {
    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL"));
    fakeApi.once("GET", "/v1/products", () =>
      json(productPage([product("A")])),
    );
    const { result } = await renderHookWithProviders(() =>
      useProductList(filters),
    );
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(names(result.current.products)).toEqual(["A"]);
    });
    expect(cursors()).toEqual([null, null]);
  });
});
