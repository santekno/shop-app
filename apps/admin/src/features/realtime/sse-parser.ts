/**
 * One Server-Sent Event, as the HTML standard's EventSource would hand it
 * to `onmessage`: its type (`event:`, "message" when the frame has none),
 * its data (every `data:` line, joined with "\n") and the stream's last
 * event ID at that moment (`id:`).
 */
export interface SseEvent {
  type: string;
  data: string;
  /**
   * The last `id:` seen on the stream so far, as the standard defines it:
   * it carries over to later events that have no `id:` of their own. Every
   * `order` event of GET /v1/admin/events carries its own `id:`, so for
   * those it is the event's ID.
   */
  lastEventId: string;
}

/** What the parser calls as it recognises the parts of a stream. */
export interface SseHandlers {
  /** A complete event (its blank line has arrived). */
  onEvent: (event: SseEvent) => void;
  /** A comment line, without its ":" (the API's "connected" and "ping"). */
  onComment?: (text: string) => void;
  /** A `retry:` field: the reconnection time the server asks for, in ms. */
  onRetry?: (ms: number) => void;
}

/** The parser's interface: feed it text in pieces of any size. */
export interface SseParser {
  feed: (chunk: string) => void;
}

const LF = 10;
const CR = 13;
const BOM = "﻿";
const DIGITS = /^\d+$/;

/**
 * A parser for the `text/event-stream` format, written from the HTML
 * standard's "event stream interpretation" (html.spec.whatwg.org,
 * § 9.2.6), with no framework and no DOM: it takes text and calls
 * `handlers`. event-stream.ts feeds it what TextDecoderStream makes of
 * the response's bytes.
 *
 * What the standard asks, and where it happens here:
 *
 * - **Chunks split anywhere.** The network hands over bytes in pieces
 *   that ignore lines: a line, a field name, even "\r\n" may be cut in
 *   two. The unfinished line waits in `pending` until its end arrives. A
 *   character cut in the middle of its UTF-8 bytes never reaches this
 *   parser: TextDecoderStream keeps those bytes until the rest arrive.
 * - **Three line endings.** "\r\n", "\n" or a lone "\r" each end a line.
 *   A chunk that ends with "\r" cannot know yet whether "\n" follows, so
 *   `afterCR` remembers it and the next chunk drops a leading "\n".
 * - **A BOM** (U+FEFF) at the very start of the stream is dropped, once.
 *   (TextDecoderStream already drops it; this is for text from anywhere.)
 * - **Lines.** An empty line dispatches the event built so far. A line
 *   starting with ":" is a comment. Otherwise the field name is the text
 *   before the first ":", and the value is the rest, minus one leading
 *   space; a line without ":" is a field with an empty value.
 * - **Fields.** `event` sets the type; `data` appends its value and a
 *   "\n" (so several `data:` lines make one multi-line value); `id` sets
 *   the last event ID unless the value contains NUL; `retry` with only
 *   ASCII digits is reported through `onRetry`; any other field is
 *   ignored.
 * - **Dispatch.** An event with no `data:` line is not dispatched, only
 *   reset. The final "\n" of the data is removed. The type defaults to
 *   "message".
 * - **The end of the stream** in the middle of an event (no blank line
 *   yet) discards it: there is nothing to call at the end, the unfinished
 *   event is simply never dispatched.
 *
 * `retry:` is parsed (the format has it), and ignored by the dashboard's
 * connection (connection.ts): the API never sends one, and the client's
 * reconnect policy (backoff with jitter, longer after a 429) is more than
 * one number can say.
 */
export const createSseParser = (handlers: SseHandlers): SseParser => {
  // The text of the line not finished yet.
  let pending = "";
  // The previous chunk ended with "\r": a "\n" opening this one is part of
  // the same line ending.
  let afterCR = false;
  // Nothing has arrived yet: a BOM here is dropped.
  let atStart = true;

  // The event being built.
  let eventType = "";
  let data = "";
  let lastEventId = "";

  const dispatch = () => {
    if (data === "") {
      eventType = "";
      return;
    }
    const event: SseEvent = {
      type: eventType === "" ? "message" : eventType,
      // Every data line added a "\n"; the last one is not part of the value.
      data: data.slice(0, -1),
      lastEventId,
    };
    eventType = "";
    data = "";
    handlers.onEvent(event);
  };

  const processField = (field: string, value: string) => {
    switch (field) {
      case "event":
        eventType = value;
        break;
      case "data":
        data += `${value}\n`;
        break;
      case "id":
        if (!value.includes("\0")) lastEventId = value;
        break;
      case "retry":
        if (DIGITS.test(value)) handlers.onRetry?.(Number(value));
        break;
      default:
        // An unknown field is ignored, so the format can grow.
        break;
    }
  };

  const processLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) {
      // ": ping" → "ping": the space after the colon is not the text.
      const text = line.slice(1);
      handlers.onComment?.(text.startsWith(" ") ? text.slice(1) : text);
      return;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      processField(line, "");
      return;
    }
    const value = line.slice(colon + 1);
    processField(
      line.slice(0, colon),
      value.startsWith(" ") ? value.slice(1) : value,
    );
  };

  return {
    feed: (chunk: string) => {
      let text = chunk;
      if (text === "") return;
      if (atStart) {
        atStart = false;
        if (text.startsWith(BOM)) text = text.slice(1);
      }
      if (afterCR) {
        afterCR = false;
        if (text.charCodeAt(0) === LF) text = text.slice(1);
      }

      // `pending` holds no line ending (it was cut at the last one), so
      // the scan starts where the new text does: a long line that arrives
      // in many chunks is scanned once, not once per chunk.
      let buffer = pending + text;
      let scan = pending.length;
      let lineStart = 0;
      while (scan < buffer.length) {
        const code = buffer.charCodeAt(scan);
        if (code !== LF && code !== CR) {
          scan++;
          continue;
        }
        processLine(buffer.slice(lineStart, scan));
        if (code === CR) {
          if (scan + 1 === buffer.length) {
            // "\r" ends this chunk: a "\n" may still follow in the next.
            afterCR = true;
          } else if (buffer.charCodeAt(scan + 1) === LF) {
            scan++;
          }
        }
        scan++;
        lineStart = scan;
      }
      buffer = buffer.slice(lineStart);
      pending = buffer;
    },
  };
};
