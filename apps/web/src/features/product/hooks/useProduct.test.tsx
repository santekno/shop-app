import { isApiError } from "@goshop/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  product,
  productResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { useProduct } from "./useProduct.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/** Every request waits for the test to answer it, in order. */
const answerLater = () => {
  const calls: {
    path: string;
    signal: AbortSignal | null | undefined;
    answer: (response: Response) => void;
  }[] = [];
  fetchMock.mockImplementation((input, init) => {
    const response = deferred<Response>();
    calls.push({
      path: requestUrl(input).pathname,
      signal: init?.signal,
      answer: response.resolve,
    });
    return response.promise;
  });
  return calls;
};

const call = (calls: ReturnType<typeof answerLater>, n: number) => {
  const found = calls[n];
  if (!found) throw new Error(`request ${n} was not sent`);
  return found;
};

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const render = (slug: string) =>
  renderHook((props: { slug: string }) => useProduct(props.slug), {
    initialProps: { slug },
  });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useProduct", () => {
  it("loads the product by slug: loading, then success", async () => {
    const calls = answerLater();
    const { result } = render("kaos-polos");

    expect(result.current.state).toEqual({ status: "loading" });
    expect(call(calls, 0).path).toBe("/v1/products/kaos-polos");

    const kaos = product("kaos-polos");
    call(calls, 0).answer(productResponse(kaos));
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
    expect(result.current.state).toEqual({ status: "success", data: kaos });
  });

  it("reports an unknown slug as a NOT_FOUND error", async () => {
    const calls = answerLater();
    const { result } = render("nope");

    call(calls, 0).answer(errorResponse(404, "NOT_FOUND"));
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });
    const { state } = result.current;
    expect(
      state.status === "error" && isApiError(state.error, "NOT_FOUND"),
    ).toBe(true);
  });

  it("asks again on retry after an error", async () => {
    const calls = answerLater();
    const { result } = render("kaos");
    call(calls, 0).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    act(() => {
      result.current.retry();
    });

    expect(result.current.state).toEqual({ status: "loading" });
    expect(call(calls, 1).path).toBe("/v1/products/kaos");
    call(calls, 1).answer(productResponse(product("kaos")));
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
  });

  it("can retry more than once", async () => {
    const calls = answerLater();
    const { result } = render("kaos");
    call(calls, 0).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });
    act(() => {
      result.current.retry();
    });
    call(calls, 1).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    act(() => {
      result.current.retry();
    });

    expect(calls).toHaveLength(3);
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("shows loading for a new slug, never the previous product", async () => {
    const calls = answerLater();
    const { result, rerender } = render("kaos");
    call(calls, 0).answer(productResponse(product("kaos")));
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });

    rerender({ slug: "kemeja" });

    expect(result.current.state).toEqual({ status: "loading" });
    expect(call(calls, 1).path).toBe("/v1/products/kemeja");
    const kemeja = product("kemeja");
    call(calls, 1).answer(productResponse(kemeja));
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "success", data: kemeja });
    });
  });

  it("ignores a late answer for the previous slug", async () => {
    const calls = answerLater();
    const { result, rerender } = render("kaos");

    rerender({ slug: "kemeja" });
    expect(call(calls, 0).signal?.aborted).toBe(true);
    call(calls, 0).answer(productResponse(product("kaos")));
    await flush();

    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("ignores a late answer from an earlier visit to the same slug", async () => {
    const calls = answerLater();
    const { result, rerender } = render("kaos");
    rerender({ slug: "kemeja" });
    rerender({ slug: "kaos" });
    expect(calls.map((c) => c.signal?.aborted)).toEqual([true, true, false]);

    call(calls, 0).answer(productResponse(product("kaos", { name: "Lama" })));
    await flush();
    expect(result.current.state).toEqual({ status: "loading" });

    const fresh = product("kaos", { name: "Baru" });
    call(calls, 2).answer(productResponse(fresh));
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "success", data: fresh });
    });
  });

  it("aborts the request on unmount", () => {
    const calls = answerLater();
    const { unmount } = render("kaos");
    expect(call(calls, 0).signal?.aborted).toBe(false);

    unmount();

    expect(call(calls, 0).signal?.aborted).toBe(true);
  });

  it("keeps retry the same function until the slug changes", () => {
    answerLater();
    const { result, rerender } = render("kaos");
    const { retry } = result.current;

    rerender({ slug: "kaos" });
    expect(result.current.retry).toBe(retry);
    rerender({ slug: "kemeja" });
    expect(result.current.retry).not.toBe(retry);
  });

  it("shows loading, then the product again, when an earlier slug comes back (A, B, A)", async () => {
    const paths: string[] = [];
    fetchMock.mockImplementation((input) => {
      const { pathname } = requestUrl(input);
      paths.push(pathname);
      if (pathname !== "/v1/products/kaos") return new Promise(() => undefined);
      return Promise.resolve(productResponse(product("kaos")));
    });
    const { result, rerender } = render("kaos");
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });

    rerender({ slug: "kemeja" });
    expect(result.current.state).toEqual({ status: "loading" });
    rerender({ slug: "kaos" });

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: "success",
        data: product("kaos"),
      });
    });
    expect(paths).toEqual([
      "/v1/products/kaos",
      "/v1/products/kemeja",
      "/v1/products/kaos",
    ]);
  });

  it("ignores retry from a render with another slug", async () => {
    const calls = answerLater();
    const { result, rerender } = render("kaos");
    const stale = result.current.retry;
    rerender({ slug: "kemeja" });
    call(calls, 1).answer(errorResponse(500, "INTERNAL_ERROR"));
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    act(() => {
      stale();
    });
    await flush();

    expect(calls).toHaveLength(2);
    expect(result.current.state.status).toBe("error");
  });
});
