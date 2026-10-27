import { ApiError } from "@goshop/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  deferred,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { createTestQueryClient } from "@/test/render.tsx";
import { useCategoryTree } from "./useCategoryTree.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const setup = () => {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

const signalOf = (call: number) => fetchMock.mock.calls[call]?.[1]?.signal;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCategoryTree", () => {
  it("starts pending, then holds the categories as a tree", async () => {
    fetchMock.mockResolvedValue(
      categoriesResponse([
        category("1", "Pakaian"),
        category("2", "Kaos", "1"),
      ]),
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useCategoryTree(), { wrapper });

    expect(result.current.status).toBe("pending");
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.data).toEqual([
      {
        ...category("1", "Pakaian"),
        children: [{ ...category("2", "Kaos", "1"), children: [] }],
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/v1/categories");
  });

  it("keeps the API's flat list in the cache; the tree is only selected", async () => {
    const flat = [category("1", "Pakaian"), category("2", "Kaos", "1")];
    fetchMock.mockResolvedValue(categoriesResponse(flat));
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => useCategoryTree(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(queryClient.getQueryData(["categories"])).toEqual(flat);
  });

  it("shares one request between every component that uses it", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([category("1", "A")]));
    const { wrapper } = setup();

    const { result } = renderHook(
      () => [useCategoryTree(), useCategoryTree()] as const,
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current[1].status).toBe("success");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current[0].data).toEqual(result.current[1].data);
  });

  it("moves to the error state with the ApiError, without retrying", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR", "req-1"));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCategoryTree(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: "req-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the request when the last user unmounts", () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const { wrapper } = setup();

    const { unmount } = renderHook(() => useCategoryTree(), { wrapper });
    expect(signalOf(0)?.aborted).toBe(false);
    unmount();

    expect(signalOf(0)?.aborted).toBe(true);
  });

  it("fetches again on refetch after an error", async () => {
    const answer = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR"))
      .mockImplementationOnce(() => answer.promise);
    const { wrapper } = setup();
    const { result } = renderHook(() => useCategoryTree(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    act(() => {
      void result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    answer.resolve(categoriesResponse([category("1", "Pakaian")]));
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
  });
});
