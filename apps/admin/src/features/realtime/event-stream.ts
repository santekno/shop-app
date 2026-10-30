import { ApiError, isErrorBody } from "@goshop/shared";
import { createSseParser } from "./sse-parser.ts";
import type { SseEvent } from "./sse-parser.ts";

/**
 * How long a stream may stay silent before it counts as dead: two of the
 * API's 25-second heartbeats plus a margin. A laptop that slept, or a
 * Wi-Fi that changed, can leave a connection that is gone without either
 * side being told; nothing ever arrives on it again, and only a clock
 * notices. Any byte (an event, a ": ping") restarts the count.
 */
export const IDLE_TIMEOUT_MS = 60_000;

/** How a stream that opened came to an end, when nothing failed. */
export type StreamEnd =
  /** The server's last `event: end`: "token_expired", "shutdown", or a reason this client does not know. */
  | { kind: "end"; reason: string }
  /** The stream closed without an `end` event (a lost Redis subscription, a proxy). */
  | { kind: "closed" };

export interface StreamEventsOptions {
  /** The full URL of GET /v1/admin/events. */
  url: string;
  /** The access token, sent as `Authorization: Bearer`. */
  accessToken: string;
  /** Aborting it closes the stream; the promise then rejects with ABORTED. */
  signal: AbortSignal;
  /** The answer was 200 and the stream is open (the API has subscribed). */
  onOpen: () => void;
  /** Every event but `end`, in order. */
  onEvent: (event: SseEvent) => void;
  /** Tests pass a fake; the default is the browser's fetch. */
  fetch?: typeof fetch;
  idleTimeoutMs?: number;
}

const isEventStream = (response: Response): boolean =>
  (response.headers.get("Content-Type") ?? "")
    .toLowerCase()
    .startsWith("text/event-stream");

/** The ApiError a refused request describes, as the API client builds it. */
const errorFrom = async (response: Response): Promise<ApiError> => {
  const requestId = response.headers.get("X-Request-ID") ?? undefined;
  let body: unknown;
  try {
    body = JSON.parse(await response.text()) as unknown;
  } catch {
    body = undefined;
  }
  if (isErrorBody(body)) {
    const { code, message, details } = body.error;
    return new ApiError({
      status: response.status,
      code,
      message,
      details,
      requestId,
    });
  }
  return new ApiError({
    status: response.status,
    code: "INVALID_RESPONSE",
    message: `unexpected response from the event stream (HTTP ${response.status})`,
    requestId,
  });
};

/** The `reason` of an `end` event's `{"reason":"…"}`, or "" when unreadable. */
const endReason = (data: string): string => {
  try {
    const value = JSON.parse(data) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "reason" in value &&
      typeof value.reason === "string"
    ) {
      return value.reason;
    }
  } catch {
    // Not JSON: an end with no reason this client can act on.
  }
  return "";
};

/**
 * Opens GET /v1/admin/events once and reads it until it ends. One
 * connection, no retry: connection.ts decides what happens next.
 *
 * Why `fetch` and not `EventSource`: EventSource cannot send an
 * `Authorization` header, and the access token must not go in the URL,
 * where access logs and proxies keep it (ADR 0009). With fetch, the
 * response body is a ReadableStream of bytes; TextDecoderStream turns it
 * into text (keeping a UTF-8 character that is split between two chunks
 * until its last byte arrives), and sse-parser.ts turns the text into
 * events. EventSource's own reconnect is not missed: it would retry with
 * the same, expired token.
 *
 * Resolves with how the stream ended. Rejects with an ApiError:
 * - the API refused it: its status and code (401 UNAUTHORIZED,
 *   403 FORBIDDEN, 429 TOO_MANY_STREAMS, …);
 * - a 200 that is not an event stream: INVALID_RESPONSE;
 * - the network failed, before or during the stream: NETWORK_ERROR;
 * - nothing arrived for `idleTimeoutMs`: CLIENT_TIMEOUT;
 * - `signal` aborted: ABORTED.
 */
export const streamEvents = async ({
  url,
  accessToken,
  signal,
  onOpen,
  onEvent,
  fetch: fetchFn = globalThis.fetch,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}: StreamEventsOptions): Promise<StreamEnd> => {
  // Our own controller: the caller's signal aborts it, and so does the
  // idle timer, with a reason of its own, so the catch can tell them apart.
  const controller = new AbortController();
  const idle = new DOMException(
    `no data for ${idleTimeoutMs} ms`,
    "TimeoutError",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restartIdleTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(idle);
    }, idleTimeoutMs);
  };
  const onAbort = () => {
    controller.abort(signal.reason);
  };
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    restartIdleTimer();
    const response = await fetchFn(url, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      // Never from the HTTP cache: every response is a new stream.
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFrom(response);
    if (!isEventStream(response) || response.body === null) {
      await response.body?.cancel();
      throw new ApiError({
        status: response.status,
        code: "INVALID_RESPONSE",
        message: "the event stream answered without text/event-stream",
      });
    }
    onOpen();

    // An object, not a `let`: TypeScript does not see assignments made in
    // a callback, and would decide the loop's check can never be true.
    const stream: { ended: StreamEnd | null } = { ended: null };
    const parser = createSseParser({
      onEvent: (event) => {
        if (stream.ended !== null) return;
        if (event.type === "end") {
          stream.ended = { kind: "end", reason: endReason(event.data) };
          return;
        }
        try {
          onEvent(event);
        } catch (error) {
          // A bug in a handler must not pass for a network failure (and
          // a reconnect): report it like an uncaught error, read on.
          reportError(error);
        }
      },
    });

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { kind: "closed" };
        restartIdleTimer();
        parser.feed(value);
        // The server closes right after `end`; no need to wait for it.
        if (stream.ended !== null) return stream.ended;
      }
    } finally {
      // Releases the connection whichever way the loop was left.
      reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted) {
      throw new ApiError({
        status: 0,
        code: "ABORTED",
        message: "the event stream was closed",
        cause: error,
      });
    }
    if (controller.signal.reason === idle) {
      throw new ApiError({
        status: 0,
        code: "CLIENT_TIMEOUT",
        message: `the event stream sent nothing for ${idleTimeoutMs} ms`,
        cause: error,
      });
    }
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "the event stream could not be reached or was cut off",
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
};
