import { renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  fetchMock,
  product,
  productResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { loadProductPage } from "../lazy.ts";
import { usePrefetchProduct } from "./usePrefetchProduct.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
vi.mock("../lazy.ts", () => ({
  loadProductPage: vi.fn(() => Promise.resolve({})),
}));

const pointer = (pointerType: string) =>
  ({ pointerType }) as PointerEvent<HTMLElement>;

const productRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/products/kaos",
  ).length;

const setup = (client = createTestQueryClient()) => {
  const { result } = renderHook(() => usePrefetchProduct("kaos"), {
    wrapper: hookWrapper(client),
  });
  return { handlers: () => result.current, client };
};

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(productResponse(product("kaos"))),
  );
  vi.mocked(loadProductPage).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePrefetchProduct", () => {
  it("prefetches the product and its page after the mouse rests 100 ms", async () => {
    const { handlers, client } = setup();

    handlers().onPointerEnter(pointer("mouse"));
    await vi.advanceTimersByTimeAsync(99);
    expect(productRequests()).toBe(0);
    expect(loadProductPage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(productRequests()).toBe(1);
    expect(loadProductPage).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(client.getQueryData(["products", "detail", "kaos"])).toEqual(
        product("kaos"),
      );
    });
  });

  it("prefetches nothing when the mouse leaves before 100 ms", async () => {
    const { handlers } = setup();

    handlers().onPointerEnter(pointer("mouse"));
    await vi.advanceTimersByTimeAsync(60);
    handlers().onPointerLeave();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(productRequests()).toBe(0);
    expect(loadProductPage).not.toHaveBeenCalled();
  });

  it("starts the delay again when the mouse comes back", async () => {
    const { handlers } = setup();

    handlers().onPointerEnter(pointer("mouse"));
    await vi.advanceTimersByTimeAsync(60);
    handlers().onPointerEnter(pointer("mouse"));
    await vi.advanceTimersByTimeAsync(60);
    expect(productRequests()).toBe(0);

    await vi.advanceTimersByTimeAsync(40);
    expect(productRequests()).toBe(1);
  });

  it.each(["touch", "pen"])("ignores a %s pointer", async (type) => {
    const { handlers } = setup();

    handlers().onPointerEnter(pointer(type));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(productRequests()).toBe(0);
    expect(loadProductPage).not.toHaveBeenCalled();
  });

  it("prefetches at once on keyboard focus", () => {
    const { handlers } = setup();

    handlers().onFocus();

    expect(productRequests()).toBe(1);
    expect(loadProductPage).toHaveBeenCalledTimes(1);
  });

  it("does not fetch a product again while its cached copy is fresh", async () => {
    const { handlers } = setup();

    handlers().onFocus();
    await vi.advanceTimersByTimeAsync(10);
    handlers().onFocus();
    await vi.advanceTimersByTimeAsync(10);

    expect(productRequests()).toBe(1);
  });

  it("swallows a failed prefetch and a failed chunk download", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorResponse(500, "INTERNAL_ERROR")),
    );
    vi.mocked(loadProductPage).mockImplementationOnce(() =>
      Promise.reject(new Error("chunk failed")),
    );
    const { handlers, client } = setup();

    handlers().onFocus();
    await vi.advanceTimersByTimeAsync(10);

    expect(productRequests()).toBe(1);
    expect(client.getQueryData(["products", "detail", "kaos"])).toBeUndefined();
  });
});
