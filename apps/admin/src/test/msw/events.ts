// GET /v1/admin/events (Bab 12 artikel 09): a streamed text/event-stream
// answer, written one chunk at a time like the API's, so the client's
// parser sees frames cut wherever the test cuts them.
import { http, HttpResponse } from "msw";
import type { AdminOrderEvent, ErrorBody } from "@goshop/shared";
import type { Answer } from "./answers.ts";
import { apiUrl } from "./http.ts";

/** The `data` of one `order` event, as the API writes it. */
export const orderEventFrame = (id: string, event: AdminOrderEvent): string =>
  `id: ${id}\nevent: order\ndata: ${JSON.stringify(event)}\n\n`;

/** The API's last frame before it closes a stream. */
export const endFrame = (reason: string): string =>
  `event: end\ndata: ${JSON.stringify({ reason })}\n\n`;

/**
 * A live stream the test writes to: `push` sends a chunk, `close` ends
 * the body. Until `close`, the response stays open, as the API's does.
 */
export const openStream = () => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    body,
    push: (chunk: string) => {
      controller.enqueue(encoder.encode(chunk));
    },
    close: () => {
      controller.close();
    },
    /** Cuts the stream off mid-way, like a dropped connection. */
    fail: (reason: unknown = new TypeError("network connection lost")) => {
      controller.error(reason);
    },
  };
};

/** 200 text/event-stream with `body`, the API's headers included. */
export const eventStreamResponse = (
  body: ReadableStream<Uint8Array> | string,
) =>
  new HttpResponse(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    },
  });

/**
 * A stream that sends `chunks` and then closes: `event: end` and its
 * reason included, if the test put one in.
 */
export const streamOf = (chunks: readonly string[]) => () => {
  const stream = openStream();
  for (const chunk of chunks) stream.push(chunk);
  stream.close();
  return eventStreamResponse(stream.body);
};

/** GET /v1/admin/events, answered per connection by `answer`. */
export const eventsHandler = (answer: Answer) =>
  http.get<never, never, ErrorBody>(apiUrl("/v1/admin/events"), ({ request }) =>
    answer(request),
  );

/**
 * A `fetch` for streamEvents' `fetch` option that answers with `stream`
 * and, like the browser's, errors the body when the request is aborted.
 * For the tests MSW cannot serve: fake timers, and a body that fails.
 */
export const fetchStream =
  (stream: ReturnType<typeof openStream>): typeof fetch =>
  (_input, init) => {
    init?.signal?.addEventListener("abort", () => {
      stream.fail(init.signal?.reason);
    });
    return Promise.resolve(eventStreamResponse(stream.body));
  };

/**
 * A stream that opens and stays quiet: for a test of a dashboard page,
 * where the layout's live events are there but not the subject.
 */
export const quietEventsHandler = () =>
  eventsHandler(() => {
    const stream = openStream();
    stream.push(": connected\n\n");
    return eventStreamResponse(stream.body);
  });
