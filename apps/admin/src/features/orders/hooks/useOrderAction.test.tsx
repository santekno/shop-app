import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Order } from "@goshop/shared";
import { createQueryClient } from "@/lib/query-client.ts";
import { ORDER_ID, order, orderSummary } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { HttpResponse } from "msw";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  orderActionHandler,
  orderDetailHandler,
  orderListResponse,
  orderQueueHandler,
  orderResponse,
} from "@/test/msw/orders.ts";
import { server } from "@/test/msw/server.ts";
import { renderRouteHook } from "@/test/render.tsx";
import { orderKeys } from "../api/queries.ts";
import { useAdminOrder } from "./useAdminOrder.ts";
import { useOrderAction } from "./useOrderAction.ts";
import { useOrderQueue } from "./useOrderQueue.ts";

/** A client whose cache holds a queue and the order, like after a visit. */
const seeded = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(orderKeys.queue("paid"), {
    pages: [],
    pageParams: [],
  });
  queryClient.setQueryData(orderKeys.detail(ORDER_ID), order());
  return queryClient;
};

const invalidated = (
  queryClient: ReturnType<typeof createQueryClient>,
  key: readonly unknown[],
) => queryClient.getQueryState(key)?.isInvalidated;

describe("useOrderAction", () => {
  it.each([
    ["process", { action: "process" as const }, undefined],
    ["complete", { action: "complete" as const }, undefined],
    ["cancel", { action: "cancel" as const }, undefined],
    [
      "ship",
      { action: "ship" as const, body: { tracking_number: "JNE0123456789" } },
      { tracking_number: "JNE0123456789" },
    ],
  ])(
    "POSTs %s and puts the answered order into the detail query",
    async (action, input, body) => {
      const sent = recordRequests();
      const changed = order({
        status: "processing",
        updated_at: "2026-10-30T09:00:00Z",
      });
      server.use(
        orderActionHandler(action as "process", () => orderResponse(changed)),
      );
      const queryClient = seeded();
      const { result } = renderRouteHook(() => useOrderAction(ORDER_ID), {
        queryClient,
      });

      await act(() => result.current.mutateAsync(input));

      expect(sent[0]?.url.pathname).toBe(
        `/v1/admin/orders/${ORDER_ID}/${action}`,
      );
      expect(sent[0]?.headers.get("Authorization")).toBe("Bearer token-1");
      if (body === undefined) {
        await expect(sent[0]?.json()).rejects.toThrow();
      } else {
        expect(await sent[0]?.json()).toEqual(body);
      }
      expect(
        queryClient.getQueryData<Order>(orderKeys.detail(ORDER_ID)),
      ).toEqual(changed);
      expect(invalidated(queryClient, orderKeys.queue("paid"))).toBe(true);
      expect(invalidated(queryClient, orderKeys.detail(ORDER_ID))).toBe(false);
    },
  );

  it.each([
    [409, "INVALID_TRANSITION"],
    [404, "NOT_FOUND"],
  ])("refetches the order before settling after a %d", async (status, code) => {
    server.use(
      orderActionHandler("process", () => errorResponse(status, code)),
    );
    const refetch = deferred<Response>();
    server.use(orderDetailHandler(() => refetch.promise));
    const queryClient = seeded();
    const { result } = renderRouteHook(
      () => ({
        action: useOrderAction(ORDER_ID),
        detail: useAdminOrder(ORDER_ID),
      }),
      { queryClient },
    );
    let settled = false;

    act(() => {
      result.current.action.mutate(
        { action: "process" },
        {
          onSettled: () => {
            settled = true;
          },
        },
      );
    });
    await waitFor(() => {
      expect(result.current.detail.isFetching).toBe(true);
    });
    expect(settled).toBe(false);
    expect(invalidated(queryClient, orderKeys.queue("paid"))).toBe(true);

    refetch.resolve(orderResponse(order({ status: "cancelled" })));
    await waitFor(() => {
      expect(settled).toBe(true);
    });
    expect(result.current.detail.data?.status).toBe("cancelled");
    expect(result.current.action.error).toMatchObject({ code });
  });

  it.each([
    ["a server error", () => errorResponse(500, "INTERNAL_ERROR")],
    ["a dropped connection", () => HttpResponse.error()],
  ])(
    "settles at once after %s, then refetches the order and the queues",
    async (_name, failure) => {
      server.use(orderActionHandler("process", failure));
      const refetch = deferred<Response>();
      server.use(orderDetailHandler(() => refetch.promise));
      const queryClient = seeded();
      const { result } = renderRouteHook(
        () => ({
          action: useOrderAction(ORDER_ID),
          detail: useAdminOrder(ORDER_ID),
        }),
        { queryClient },
      );
      let settled = false;

      act(() => {
        result.current.action.mutate(
          { action: "process" },
          {
            onSettled: () => {
              settled = true;
            },
          },
        );
      });

      // Settled while the refetch still hangs: the seller reads "check
      // the status" now, not after a server that did not answer does.
      await waitFor(() => {
        expect(settled).toBe(true);
      });
      expect(result.current.detail.isFetching).toBe(true);
      expect(invalidated(queryClient, orderKeys.queue("paid"))).toBe(true);
      expect(invalidated(queryClient, orderKeys.detail(ORDER_ID))).toBe(true);

      refetch.resolve(orderResponse(order({ status: "processing" })));
      await waitFor(() => {
        expect(result.current.detail.data?.status).toBe("processing");
      });
    },
  );

  it("refetches nothing after a failure retrying may fix", async () => {
    const sent = recordRequests();
    server.use(
      orderActionHandler("process", () => errorResponse(429, "RATE_LIMITED")),
    );
    const queryClient = seeded();
    const { result } = renderRouteHook(() => useOrderAction(ORDER_ID), {
      queryClient,
    });

    await act(() =>
      result.current.mutateAsync({ action: "process" }).catch(() => undefined),
    );

    expect(sent.map((r) => r.method)).toEqual(["POST"]);
    expect(invalidated(queryClient, orderKeys.queue("paid"))).toBe(false);
    expect(queryClient.getQueryData(orderKeys.detail(ORDER_ID))).toEqual(
      order(),
    );
  });
});

describe("useOrderQueue and useAdminOrder", () => {
  it("load as the logged-in user, under their keys", async () => {
    const sent = recordRequests();
    server.use(
      orderQueueHandler(() =>
        orderListResponse([orderSummary(1, { status: "shipped" })]),
      ),
      orderDetailHandler(order()),
    );
    const queryClient = createQueryClient();
    const { result } = renderRouteHook(
      () => ({
        queue: useOrderQueue("shipped"),
        detail: useAdminOrder(ORDER_ID),
      }),
      { queryClient },
    );

    await waitFor(() => {
      expect(
        result.current.queue.isSuccess && result.current.detail.isSuccess,
      ).toBe(true);
    });
    expect(result.current.queue.data?.pages[0]?.data[0]?.id).toBe(
      orderSummary(1).id,
    );
    expect(result.current.detail.data).toEqual(order());
    expect(queryClient.getQueryData(orderKeys.detail(ORDER_ID))).toEqual(
      order(),
    );
    expect(
      sent.every((r) => r.headers.get("Authorization") === "Bearer token-1"),
    ).toBe(true);
  });
});
