import { ApiError } from "@goshop/shared";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { networkError } from "@/test/msw/answers.ts";
import {
  endFrame,
  eventStreamResponse,
  eventsHandler,
  fetchStream,
  openStream,
  streamOf,
} from "@/test/msw/events.ts";
import { apiUrl, errorResponse, recordRequests } from "@/test/msw/http.ts";
import { server } from "@/test/msw/server.ts";
import { IDLE_TIMEOUT_MS, streamEvents } from "./event-stream.ts";
import type { SseEvent } from "./sse-parser.ts";

const URL_ = apiUrl("/v1/admin/events");

/** Opens the stream with recording callbacks. */
const open = (
  signal = new AbortController().signal,
  idleTimeoutMs?: number,
) => {
  const events: SseEvent[] = [];
  const onOpen = vi.fn();
  const result = streamEvents({
    url: URL_,
    accessToken: "tok-1",
    signal,
    onOpen,
    onEvent: (event) => events.push(event),
    idleTimeoutMs,
  });
  return { result, events, onOpen };
};

/** The error the stream rejected with. */
const failure = async (result: Promise<unknown>) => {
  const error = await result.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

describe("streamEvents", () => {
  it("sends the token and asks for an event stream, never from the cache", async () => {
    const sent = recordRequests();
    server.use(eventsHandler(streamOf([])));

    await open().result;

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.get("Authorization")).toBe("Bearer tok-1");
    expect(sent[0]?.headers.get("Accept")).toBe("text/event-stream");
    expect(sent[0]?.url.search).toBe("");
  });

  it("opens, hands over every event in order, and resolves 'closed' when the body ends", async () => {
    server.use(
      eventsHandler(
        streamOf([
          ": connected\n\n",
          'id: 1\nevent: order\ndata: {"a":1}\n\n',
          "id: 2\nevent: order\nda",
          'ta: {"a":2}\n\n',
        ]),
      ),
    );
    const { result, events, onOpen } = open();

    await expect(result).resolves.toEqual({ kind: "closed" });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "order", data: '{"a":1}', lastEventId: "1" },
      { type: "order", data: '{"a":2}', lastEventId: "2" },
    ]);
  });

  it("resolves with the reason of `event: end` and passes nothing after it", async () => {
    server.use(
      eventsHandler(
        streamOf([
          "id: 1\nevent: order\ndata: {}\n\n" +
            endFrame("token_expired") +
            "id: 2\nevent: order\ndata: {}\n\n",
        ]),
      ),
    );
    const { result, events } = open();

    await expect(result).resolves.toEqual({
      kind: "end",
      reason: "token_expired",
    });
    expect(events.map((event) => event.lastEventId)).toEqual(["1"]);
  });

  it("returns at `end` without waiting for the server to close", async () => {
    const stream = openStream();
    server.use(eventsHandler(() => eventStreamResponse(stream.body)));
    const { result } = open();

    stream.push(endFrame("shutdown"));

    await expect(result).resolves.toEqual({ kind: "end", reason: "shutdown" });
  });

  it.each([
    ["not JSON", "event: end\ndata: bye\n\n"],
    ["no reason", 'event: end\ndata: {"why":"x"}\n\n'],
    ["a numeric reason", 'event: end\ndata: {"reason":3}\n\n'],
    ["null", "event: end\ndata: null\n\n"],
  ])("ends with reason '' when the end's data is %s", async (_name, frame) => {
    server.use(eventsHandler(streamOf([frame])));

    await expect(open().result).resolves.toEqual({ kind: "end", reason: "" });
  });

  it("reports a handler that throws, and keeps reading", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    server.use(eventsHandler(streamOf(["data: one\n\n", "data: two\n\n"])));
    const boom = new Error("handler bug");
    const seen: string[] = [];

    const result = await streamEvents({
      url: URL_,
      accessToken: "t",
      signal: new AbortController().signal,
      onOpen: () => undefined,
      onEvent: (event) => {
        seen.push(event.data);
        if (event.data === "one") throw boom;
      },
    });

    expect(result).toEqual({ kind: "closed" });
    expect(seen).toEqual(["one", "two"]);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(boom);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [429, "TOO_MANY_STREAMS"],
    [503, "UNAVAILABLE"],
  ])(
    "rejects a %d with the API's code, without opening",
    async (status, code) => {
      server.use(
        eventsHandler(() =>
          errorResponse(status, code, { requestId: "req-9" }),
        ),
      );
      const { result, onOpen } = open();

      const error = await failure(result);

      expect(error).toMatchObject({ status, code, requestId: "req-9" });
      expect(onOpen).not.toHaveBeenCalled();
    },
  );

  it("rejects an error answer that is not the API's JSON as INVALID_RESPONSE", async () => {
    server.use(
      eventsHandler(() => HttpResponse.text("Bad Gateway", { status: 502 })),
    );

    const error = await failure(open().result);

    expect(error).toMatchObject({ status: 502, code: "INVALID_RESPONSE" });
  });

  it("rejects a 200 that is not an event stream, without opening", async () => {
    server.use(eventsHandler(() => HttpResponse.json({ data: [] })));
    const { result, onOpen } = open();

    const error = await failure(result);

    expect(error).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("accepts the content type in any case and with parameters", async () => {
    server.use(
      eventsHandler(
        () =>
          new HttpResponse("data: x\n\n", {
            headers: { "Content-Type": "Text/Event-Stream; charset=utf-8" },
          }),
      ),
    );
    const { result, events } = open();

    await expect(result).resolves.toEqual({ kind: "closed" });
    expect(events.map((e) => e.data)).toEqual(["x"]);
  });

  it("rejects NETWORK_ERROR when the API cannot be reached", async () => {
    server.use(eventsHandler(() => networkError()));

    const error = await failure(open().result);

    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  // A body that fails half-way is a real fetch's behaviour MSW does not
  // reproduce (its interceptor ends the copied body cleanly), so this one
  // case passes a Response of its own through the `fetch` option.
  it("rejects NETWORK_ERROR when the stream is cut off mid-way", async () => {
    const stream = openStream();
    const events: SseEvent[] = [];
    const result = streamEvents({
      url: URL_,
      accessToken: "t",
      signal: new AbortController().signal,
      onOpen: () => undefined,
      onEvent: (event) => events.push(event),
      fetch: fetchStream(stream),
    });

    stream.push("data: a\n\n");
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    stream.fail();

    expect(await failure(result)).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("rejects ABORTED when the caller closes an open stream", async () => {
    const stream = openStream();
    server.use(eventsHandler(() => eventStreamResponse(stream.body)));
    const controller = new AbortController();
    const { result, onOpen } = open(controller.signal);
    stream.push(": connected\n\n");
    await vi.waitFor(() => {
      expect(onOpen).toHaveBeenCalled();
    });

    controller.abort();

    expect(await failure(result)).toMatchObject({ status: 0, code: "ABORTED" });
  });

  it("rejects ABORTED at once for a signal that is already aborted", async () => {
    const sent = recordRequests();
    server.use(eventsHandler(streamOf([])));
    const controller = new AbortController();
    controller.abort();

    expect(await failure(open(controller.signal).result)).toMatchObject({
      code: "ABORTED",
    });
    expect(sent).toHaveLength(0);
  });

  // Fake timers and MSW 3's socket-level interception do not mix (undici
  // asserts on a socket closed while its clock is frozen), so the clock
  // tests hand streamEvents a Response of their own through `fetch`.
  describe("the idle timeout", () => {
    const openWithClock = (idleTimeoutMs: number) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const stream = openStream();
      const onOpen = vi.fn();
      const result = streamEvents({
        url: URL_,
        accessToken: "t",
        signal: new AbortController().signal,
        onOpen,
        onEvent: () => undefined,
        fetch: fetchStream(stream),
        idleTimeoutMs,
      });
      const settled = vi.fn();
      void result.then(settled, settled);
      return { stream, onOpen, result, settled };
    };

    it("is 60 seconds", () => {
      expect(IDLE_TIMEOUT_MS).toBe(60_000);
    });

    it("rejects CLIENT_TIMEOUT when nothing arrives for the timeout", async () => {
      const { onOpen, result, settled } = openWithClock(1_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(onOpen).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(await failure(result)).toMatchObject({
        status: 0,
        code: "CLIENT_TIMEOUT",
      });
    });

    it("starts the count again on every chunk, a ping included", async () => {
      const { stream, result, settled } = openWithClock(1_000);

      await vi.advanceTimersByTimeAsync(800);
      stream.push(": ping\n\n");
      await vi.advanceTimersByTimeAsync(800);
      expect(settled).not.toHaveBeenCalled();
      stream.push("data: x\n\n");
      await vi.advanceTimersByTimeAsync(800);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(await failure(result)).toMatchObject({ code: "CLIENT_TIMEOUT" });
    });

    it("counts the wait for the answer itself too", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const result = streamEvents({
        url: URL_,
        accessToken: "t",
        signal: new AbortController().signal,
        onOpen: () => undefined,
        onEvent: () => undefined,
        // A fetch that never answers, but stops when it is aborted.
        fetch: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
        idleTimeoutMs: 500,
      });
      const outcome = result.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(500);

      expect(await outcome).toMatchObject({ code: "CLIENT_TIMEOUT" });
    });
  });
});
