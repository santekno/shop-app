import { ApiError } from "@goshop/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  deferred,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { useCategoryTree } from "./useCategoryTree.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/** A fetch that answers only when the test says so, ignoring aborts. */
const answerLater = () => {
  const answers: ReturnType<typeof deferred<Response>>[] = [];
  fetchMock.mockImplementation(() => {
    const answer = deferred<Response>();
    answers.push(answer);
    return answer.promise;
  });
  return answers;
};

/** A fetch that never answers and rejects when aborted, like the real one. */
const hangUntilAborted = () => {
  fetchMock.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
};

/** Lets pending promise callbacks and React updates run. */
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const signalOf = (call: number) => fetchMock.mock.calls[call]?.[1]?.signal;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCategoryTree", () => {
  it("starts loading, then holds the categories as a tree", async () => {
    fetchMock.mockResolvedValue(
      categoriesResponse([
        category("1", "Pakaian"),
        category("2", "Kaos", "1"),
      ]),
    );

    const { result } = renderHook(() => useCategoryTree());

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
    expect(result.current.state).toEqual({
      status: "success",
      data: [
        {
          ...category("1", "Pakaian"),
          children: [{ ...category("2", "Kaos", "1"), children: [] }],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/v1/categories");
  });

  it("moves to the error state with the ApiError", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR", "req-1"));

    const { result } = renderHook(() => useCategoryTree());

    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });
    const { state } = result.current;
    if (state.status !== "error") throw new Error("not an error state");
    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: "req-1",
    });
  });

  it("aborts the request on unmount", () => {
    hangUntilAborted();

    const { unmount } = renderHook(() => useCategoryTree());
    expect(signalOf(0)?.aborted).toBe(false);
    unmount();

    expect(signalOf(0)?.aborted).toBe(true);
  });

  it("ignores the answer to the request StrictMode aborted, even when it comes last", async () => {
    const answers = answerLater();

    const { result } = renderHook(() => useCategoryTree(), {
      wrapper: StrictMode,
    });

    // StrictMode mounts, unmounts and mounts again: two requests, the
    // first aborted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signalOf(0)?.aborted).toBe(true);
    expect(signalOf(1)?.aborted).toBe(false);

    answers[1]?.resolve(categoriesResponse([category("new", "Baru")]));
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
    answers[0]?.resolve(categoriesResponse([category("old", "Lama")]));
    await flush();

    expect(result.current.state).toEqual({
      status: "success",
      data: [{ ...category("new", "Baru"), children: [] }],
    });
  });

  it("does not show the cancelled request as an error", async () => {
    hangUntilAborted();

    const { result } = renderHook(() => useCategoryTree(), {
      wrapper: StrictMode,
    });
    await flush();

    expect(signalOf(0)?.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("reload goes back to loading and fetches again", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR"))
      .mockImplementationOnce(() => answer.promise);
    const answer = deferred<Response>();

    const { result } = renderHook(() => useCategoryTree());
    await waitFor(() => {
      expect(result.current.state.status).toBe("error");
    });

    act(() => {
      result.current.reload();
    });

    expect(result.current.state).toEqual({ status: "loading" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    answer.resolve(categoriesResponse([category("1", "Pakaian")]));
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
  });

  it("keeps reload the same function across renders", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([]));

    const { result } = renderHook(() => useCategoryTree());
    const first = result.current.reload;
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });

    expect(result.current.reload).toBe(first);
  });
});
