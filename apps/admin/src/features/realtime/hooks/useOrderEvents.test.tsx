import type { AdminOrderEvent } from "@goshop/shared";
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { session } from "@/test/fixtures.ts";
import {
  eventStreamResponse,
  eventsHandler,
  fetchStream,
  openStream,
  orderEventFrame,
} from "@/test/msw/events.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { orderKeys } from "@/features/orders/api/queries.ts";
import { reportKeys } from "@/features/reports/api/queries.ts";
import { renderRouteHook } from "@/test/render.tsx";
import type { TestSession } from "@/test/render.tsx";
import { INVALIDATE_DELAY_MS, useOrderEvents } from "./useOrderEvents.ts";

const event = (
  type: AdminOrderEvent["type"],
  code = "GS-1",
): AdminOrderEvent => ({
  type,
  order_id: `o-${code}`,
  code,
  status: "paid",
  total: { amount: 117_000, currency: "IDR" },
  occurred_at: "2026-10-30T03:00:00Z",
});

/** One live stream per connection, which the test writes to. */
const liveStreams = () => {
  const streams: ReturnType<typeof openStream>[] = [];
  server.use(
    eventsHandler(() => {
      const stream = openStream();
      stream.push(": connected\n\n");
      streams.push(stream);
      return eventStreamResponse(stream.body);
    }),
  );
  return streams;
};

const setup = (who: TestSession = session()) => {
  const onOrderEvent = vi.fn<(event: AdminOrderEvent, id: string) => void>();
  const queryClient = createQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderRouteHook(() => useOrderEvents({ onOrderEvent }), {
    session: who,
    queryClient,
  });
  return { ...view, onOrderEvent, invalidate };
};

const ORDERS = JSON.stringify(orderKeys.all);
const REPORTS = JSON.stringify(reportKeys.all);

/** The keys invalidated so far, in order, as JSON. */
const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.map(([filters]) =>
    JSON.stringify((filters as { queryKey: unknown }).queryKey),
  );

describe("useOrderEvents", () => {
  it("opens no stream without a session", async () => {
    const sent = recordRequests();
    const { result } = setup(null);

    await act(() => Promise.resolve());

    expect(sent).toEqual([]);
    expect(result.current.status).toBe("connecting");
  });

  it("connects with the session's token and goes live", async () => {
    const sent = recordRequests();
    liveStreams();
    const { result } = setup(session("seller", "tok-9"));

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });
    expect(sent[0]?.url.pathname).toBe("/v1/admin/events");
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer tok-9");
  });

  it("refetches the orders and the reports once after connecting", async () => {
    liveStreams();
    const { invalidate } = setup();

    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toEqual([ORDERS, REPORTS]);
    });
    expect(INVALIDATE_DELAY_MS).toBe(250);
    // A running fetch is not cancelled (invalidateOrderQueries).
    expect(invalidate.mock.calls[0]?.[1]).toEqual({ cancelRefetch: false });
  });

  it("hands over each order event once, dropping repeats and unknown shapes", async () => {
    const streams = liveStreams();
    const { result, onOrderEvent } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    streams[0]?.push(
      orderEventFrame("e-1", event("order.paid", "GS-1")) +
        orderEventFrame("e-1", event("order.paid", "GS-1")) +
        'id: e-2\nevent: order\ndata: {"type":"order.refunded"}\n\n' +
        `id: e-3\nevent: ping\ndata: ${JSON.stringify(event("order.paid", "GS-3"))}\n\n` +
        orderEventFrame("e-4", event("order.created", "GS-4")),
    );

    await waitFor(() => {
      expect(onOrderEvent).toHaveBeenCalledTimes(2);
    });
    expect(onOrderEvent.mock.calls.map(([e, id]) => [e.code, id])).toEqual([
      ["GS-1", "e-1"],
      ["GS-4", "e-4"],
    ]);
  });

  it("never drops an event without an id as a repeat", async () => {
    const streams = liveStreams();
    const { result, onOrderEvent } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    const frame = `event: order\ndata: ${JSON.stringify(event("order.paid"))}\n\n`;
    streams[0]?.push(frame + frame);

    await waitFor(() => {
      expect(onOrderEvent).toHaveBeenCalledTimes(2);
    });
    expect(onOrderEvent.mock.calls.map(([, id]) => id)).toEqual(["", ""]);
  });

  it("gathers a burst of events into one refetch of the orders, and of the reports when revenue moved", async () => {
    const streams = liveStreams();
    const { result, onOrderEvent, invalidate } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toHaveLength(2);
    });

    streams[0]?.push(
      orderEventFrame("e-1", event("order.paid", "GS-1")) +
        orderEventFrame("e-2", event("order.processing", "GS-2")) +
        orderEventFrame("e-3", event("order.shipped", "GS-3")),
    );

    await waitFor(() => {
      expect(onOrderEvent).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toEqual([
        ORDERS,
        REPORTS,
        ORDERS,
        REPORTS,
      ]);
    });
  });

  it("leaves the reports alone for a burst that cannot change revenue, and forgets an earlier one", async () => {
    const streams = liveStreams();
    const { result, onOrderEvent, invalidate } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toHaveLength(2);
    });

    streams[0]?.push(orderEventFrame("e-1", event("order.cancelled", "GS-1")));
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toHaveLength(4);
    });
    streams[0]?.push(
      orderEventFrame("e-2", event("order.created", "GS-2")) +
        orderEventFrame("e-3", event("order.completed", "GS-3")),
    );
    await waitFor(() => {
      expect(onOrderEvent).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(invalidatedKeys(invalidate)).toHaveLength(5);
    });

    expect(invalidatedKeys(invalidate)).toEqual([
      ORDERS,
      REPORTS,
      ORDERS,
      REPORTS,
      ORDERS,
    ]);
  });

  it("stops with 'forbidden' when the API refuses the stream", async () => {
    server.use(eventsHandler(() => errorResponse(403, "FORBIDDEN")));
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.status).toBe("forbidden");
    });
  });

  it("closes the stream when unmounted", async () => {
    const sent = recordRequests();
    liveStreams();
    const { result, unmount } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    unmount();
    window.dispatchEvent(new Event("online"));
    await act(() => Promise.resolve());

    expect(sent).toHaveLength(1);
  });

  // The gathering delay on a fake clock: MSW 3 does not mix with fake
  // timers, so these hand the connection a fetch of their own.
  describe("on a fake clock", () => {
    const setupWithClock = () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const stream = openStream();
      stream.push(": connected\n\n");
      vi.stubGlobal("fetch", fetchStream(stream));
      return { stream, ...setup() };
    };
    const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    it("refetches only after the gathering delay", async () => {
      const { invalidate } = setupWithClock();

      await elapse(INVALIDATE_DELAY_MS - 1);
      expect(invalidate).not.toHaveBeenCalled();
      await elapse(1);

      expect(invalidatedKeys(invalidate)).toEqual([ORDERS, REPORTS]);
    });

    it("gathers events over the delay into one refetch", async () => {
      const { stream, invalidate } = setupWithClock();
      await elapse(INVALIDATE_DELAY_MS);

      stream.push(orderEventFrame("e-1", event("order.processing", "GS-1")));
      await elapse(200);
      stream.push(orderEventFrame("e-2", event("order.paid", "GS-2")));
      await elapse(49);
      expect(invalidatedKeys(invalidate)).toHaveLength(2);
      await elapse(1);

      expect(invalidatedKeys(invalidate)).toEqual([
        ORDERS,
        REPORTS,
        ORDERS,
        REPORTS,
      ]);
    });

    /**
     * The first attempt fails on the network, the next one is answered
     * by `second`: the backoff in between is a whole second
     * (random() = 1), which the test never lets pass.
     */
    const setupFailingFirst = (
      second: (init?: RequestInit) => Promise<Response>,
    ) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      vi.spyOn(Math, "random").mockReturnValue(1);
      const answers = [() => Promise.reject(new TypeError("offline")), second];
      const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const next = answers.shift();
        return next === undefined
          ? new Promise<Response>(() => undefined)
          : next(init);
      });
      vi.stubGlobal("fetch", fetch);
      return { fetch, ...setup() };
    };

    it("tries again at once when the browser comes back online", async () => {
      const stream = openStream();
      stream.push(": connected\n\n");
      const { fetch, result } = setupFailingFirst((init) =>
        fetchStream(stream)("", init),
      );
      await elapse(0);
      expect(result.current.status).toBe("reconnecting");

      window.dispatchEvent(new Event("online"));
      await elapse(0);

      expect(result.current.status).toBe("live");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("retryNow cuts a wait short", async () => {
      const { fetch, result } = setupFailingFirst(() =>
        Promise.resolve(
          Response.json(
            { error: { code: "FORBIDDEN", message: "no" } },
            { status: 403 },
          ),
        ),
      );
      await elapse(0);
      expect(result.current.status).toBe("reconnecting");

      act(() => {
        result.current.retryNow();
      });
      await elapse(0);

      expect(result.current.status).toBe("forbidden");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("refetches nothing after unmounting with a refetch still waiting", async () => {
      const { stream, invalidate, unmount } = setupWithClock();
      await elapse(INVALIDATE_DELAY_MS);
      stream.push(orderEventFrame("e-1", event("order.paid", "GS-1")));
      await elapse(100);

      unmount();
      await elapse(10 * INVALIDATE_DELAY_MS);

      expect(invalidatedKeys(invalidate)).toEqual([ORDERS, REPORTS]);
    });
  });
});
