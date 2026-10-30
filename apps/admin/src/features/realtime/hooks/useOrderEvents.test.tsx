import type { AdminOrderEvent } from "@goshop/shared";
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client.ts";
import { session } from "@/test/fixtures.ts";
import { networkError } from "@/test/msw/answers.ts";
import {
  eventStreamResponse,
  eventsHandler,
  openStream,
  orderEventFrame,
} from "@/test/msw/events.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
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

  it("refetches the order queries once after connecting", async () => {
    liveStreams();
    const { invalidate } = setup();

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledExactlyOnceWith({
        queryKey: ["admin", "orders"],
      });
    });
    expect(INVALIDATE_DELAY_MS).toBe(250);
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

  it("gathers a burst of events into one refetch", async () => {
    const streams = liveStreams();
    const { result, onOrderEvent, invalidate } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
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
      expect(invalidate).toHaveBeenCalledTimes(2);
    });
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: ["admin", "orders"],
    });
  });

  it("stops with 'forbidden' when the API refuses the stream", async () => {
    server.use(eventsHandler(() => errorResponse(403, "FORBIDDEN")));
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.status).toBe("forbidden");
    });
  });

  it("tries again at once when the browser comes back online", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    let attempts = 0;
    server.use(
      eventsHandler(() => {
        attempts += 1;
        if (attempts === 1) return networkError();
        const stream = openStream();
        stream.push(": connected\n\n");
        return eventStreamResponse(stream.body);
      }),
    );
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("reconnecting");
    });

    // The backoff would wait a whole second (random() = 1); "online" cuts it.
    window.dispatchEvent(new Event("online"));

    await waitFor(
      () => {
        expect(result.current.status).toBe("live");
      },
      { timeout: 500 },
    );
    expect(attempts).toBe(2);
  });

  it("retryNow cuts a wait short", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    let attempts = 0;
    server.use(
      eventsHandler(() => {
        attempts += 1;
        return attempts === 1
          ? networkError()
          : errorResponse(403, "FORBIDDEN");
      }),
    );
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.status).toBe("reconnecting");
    });

    act(() => {
      result.current.retryNow();
    });

    await waitFor(
      () => {
        expect(result.current.status).toBe("forbidden");
      },
      { timeout: 500 },
    );
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
});
