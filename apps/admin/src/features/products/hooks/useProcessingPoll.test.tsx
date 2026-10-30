import type { AdminProductImage } from "@goshop/shared";
import { useQuery } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { PRODUCT_ID, adminImage, adminProduct } from "@/test/fixtures.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { productKeys } from "../api/queries.ts";
import {
  POLL_DELAYS_MS,
  POLL_LIMIT_MS,
  pollDelay,
  useProcessingPoll,
} from "./useProcessingPoll.ts";

// The poll runs on a clock. MSW 3 and fake timers do not mix (slice A's
// event-stream tests found that out), so the product's detail query here
// has a query function of the test's own: each refetch the poll asks for
// is one call of `fetchProduct`, answered at once.
const setup = (images: readonly AdminProductImage[]) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const queryClient = createQueryClient();
  const fetchProduct = vi.fn(() =>
    Promise.resolve(adminProduct({ images: [...images] })),
  );
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderRouteHook(
    (props: { images: readonly AdminProductImage[] }) => {
      useQuery({
        queryKey: productKeys.detail(PRODUCT_ID),
        queryFn: fetchProduct,
        staleTime: Infinity,
      });
      return useProcessingPoll(PRODUCT_ID, props.images);
    },
    { queryClient, initialProps: { images } },
  );
  /** Refetches the poll asked for, the query's own first fetch left out. */
  const refetches = () => fetchProduct.mock.calls.length - 1;
  return { ...view, fetchProduct, invalidate, refetches };
};

const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const processing = [adminImage(1, { status: "processing" }), adminImage(2)];

afterEach(() => {
  vi.useRealTimers();
});

describe("pollDelay", () => {
  it("waits 1, 2, 3, 5, then 8 seconds for ever", () => {
    expect(POLL_DELAYS_MS).toEqual([1_000, 2_000, 3_000, 5_000, 8_000]);
    expect([0, 1, 2, 3, 4, 5, 50].map(pollDelay)).toEqual([
      1_000, 2_000, 3_000, 5_000, 8_000, 8_000, 8_000,
    ]);
    expect(POLL_LIMIT_MS).toBe(120_000);
  });
});

describe("useProcessingPoll", () => {
  it("asks nothing while no photo is processing", async () => {
    const { refetches, result } = setup([
      adminImage(1),
      adminImage(2, { status: "failed" }),
    ]);
    await elapse(0);

    await elapse(60_000);

    expect(refetches()).toBe(0);
    expect(result.current.gaveUp).toBe(false);
  });

  it("refetches the product after 1, 2, 3, 5 and then every 8 seconds", async () => {
    const { refetches } = setup(processing);
    await elapse(0);

    const at: number[] = [];
    for (const step of [
      999, 1, 1_999, 1, 2_999, 1, 4_999, 1, 7_999, 1, 7_999, 1,
    ]) {
      await elapse(step);
      at.push(refetches());
    }

    expect(at).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
  });

  it("marks the product table stale with each look", async () => {
    const { invalidate } = setup(processing);
    await elapse(1_000);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: productKeys.tables });
  });

  it("gives up after 120 seconds and asks nothing more", async () => {
    const { refetches, result } = setup(processing);
    await elapse(0);

    await elapse(POLL_LIMIT_MS - 1);
    expect(result.current.gaveUp).toBe(false);
    await elapse(8_000);
    expect(result.current.gaveUp).toBe(true);
    const given = refetches();
    await elapse(60_000);

    expect(refetches()).toBe(given);
  });

  it("starts again from 1 second on check()", async () => {
    const { refetches, result } = setup(processing);
    await elapse(POLL_LIMIT_MS + 8_000);
    expect(result.current.gaveUp).toBe(true);
    const before = refetches();

    act(() => {
      result.current.check();
    });
    expect(result.current.gaveUp).toBe(false);
    await elapse(1_000);

    expect(refetches()).toBe(before + 1);
  });

  it("forgets that it gave up when another set of photos is processing", async () => {
    const { result, rerender } = setup(processing);
    await elapse(POLL_LIMIT_MS + 8_000);
    expect(result.current.gaveUp).toBe(true);

    rerender({
      images: [...processing, adminImage(3, { status: "processing" })],
    });

    expect(result.current.gaveUp).toBe(false);
  });

  it("stops once nothing is processing any more", async () => {
    const { refetches, rerender } = setup(processing);
    await elapse(1_000);
    expect(refetches()).toBe(1);

    rerender({ images: [adminImage(1), adminImage(2)] });
    await elapse(60_000);

    expect(refetches()).toBe(1);
  });

  it("stops when unmounted", async () => {
    const { refetches, unmount } = setup(processing);
    await elapse(500);

    unmount();
    await elapse(60_000);

    expect(refetches()).toBe(0);
  });
});
