import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse-parser.ts";
import type { SseEvent } from "./sse-parser.ts";

/** A parser that records everything it reports. */
const setup = () => {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const retries: number[] = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onComment: (text) => comments.push(text),
    onRetry: (ms) => retries.push(ms),
  });
  /** Feeds every chunk in order. */
  const feed = (...chunks: string[]) => {
    for (const chunk of chunks) parser.feed(chunk);
  };
  return { feed, events, comments, retries };
};

const event = (data: string, type = "message", lastEventId = ""): SseEvent => ({
  type,
  data,
  lastEventId,
});

describe("createSseParser", () => {
  it("dispatches an event at its blank line, with its type, data and id", () => {
    const { feed, events } = setup();

    feed('id: e-1\nevent: order\ndata: {"a":1}\n\n');

    expect(events).toEqual([event('{"a":1}', "order", "e-1")]);
  });

  it.each([
    ["LF", "data: a\n\ndata: b\n\n"],
    ["CRLF", "data: a\r\n\r\ndata: b\r\n\r\n"],
    ["a lone CR", "data: a\r\rdata: b\r\r"],
    ["mixed endings", "data: a\r\n\ndata: b\r\r\n"],
  ])("ends lines on %s", (_name, text) => {
    const { feed, events } = setup();

    feed(text);

    expect(events.map((e) => e.data)).toEqual(["a", "b"]);
  });

  it("joins CR and LF split across two chunks into one line ending", () => {
    const { feed, events } = setup();

    feed("data: a\r", "\ndata: b\r", "\n\r\n");

    // Read as two endings, the "\n" would be an empty line and dispatch
    // "a" and "b" as two events.
    expect(events.map((e) => e.data)).toEqual(["a\nb"]);
  });

  it("reads CRLF inside one chunk as one line ending", () => {
    const { feed, events } = setup();

    feed("data: a\r\ndata: b\r\n\r\n");

    expect(events.map((e) => e.data)).toEqual(["a\nb"]);
  });

  it("starts each event as 'message' again after a typed one", () => {
    const { feed, events } = setup();

    feed("event: order\ndata: a\n\n", "data: b\n\n");

    expect(events.map((e) => e.type)).toEqual(["order", "message"]);
  });

  it("does not drop a real character after a chunk-ending CR", () => {
    const { feed, events } = setup();

    feed("data: a\r", "\rdata: b\n\n");

    expect(events.map((e) => e.data)).toEqual(["a", "b"]);
  });

  it("puts a line cut anywhere back together", () => {
    const { feed, events } = setup();
    const text = 'id: 7\nevent: order\ndata: {"code":"GS-1"}\n\n';

    feed(...text.split(""));

    expect(events).toEqual([event('{"code":"GS-1"}', "order", "7")]);
  });

  it("reads a long line that arrives in many chunks", () => {
    const { feed, events } = setup();
    const long = "x".repeat(10_000);

    feed("data: ", ...(long.match(/.{1,7}/g) ?? []), "\n\n");

    expect(events[0]?.data).toBe(long);
  });

  it("drops a BOM at the start of the stream, once", () => {
    const { feed, events } = setup();

    feed("﻿data: a\n\n", "﻿data: b\n\n");

    // The second BOM is not at the stream's start: it is part of the
    // field name, which is then unknown, so nothing is dispatched for it.
    expect(events.map((e) => e.data)).toEqual(["a"]);
  });

  it("removes exactly one space after the colon", () => {
    const { feed, events } = setup();

    feed("data:a\n\n", "data:  b\n\n");

    expect(events.map((e) => e.data)).toEqual(["a", " b"]);
  });

  it("reads a line without a colon as a field with an empty value", () => {
    const { feed, events } = setup();

    feed("data\ndata\n\n");

    expect(events.map((e) => e.data)).toEqual(["\n"]);
  });

  it("joins several data lines with a newline", () => {
    const { feed, events } = setup();

    feed("data: one\ndata: two\ndata: three\n\n");

    expect(events[0]?.data).toBe("one\ntwo\nthree");
  });

  it("dispatches an empty data line as an empty string", () => {
    const { feed, events } = setup();

    feed("event: ping\ndata:\n\n");

    expect(events).toEqual([event("", "ping")]);
  });

  it("does not dispatch an event without data, and forgets its type", () => {
    const { feed, events } = setup();

    feed("event: order\n\n", "data: x\n\n");

    expect(events).toEqual([event("x")]);
  });

  it("ignores an id containing NUL and keeps the previous one", () => {
    const { feed, events } = setup();

    feed("id: 1\ndata: a\n\n", "id: 2\0x\ndata: b\n\n");

    expect(events.map((e) => e.lastEventId)).toEqual(["1", "1"]);
  });

  it("carries the last id over to later events without one", () => {
    const { feed, events } = setup();

    feed("id: 41\ndata: a\n\n", "data: b\n\n", "id:\ndata: c\n\n");

    expect(events.map((e) => e.lastEventId)).toEqual(["41", "41", ""]);
  });

  it("reports retry only for ASCII digits", () => {
    const { feed, retries, events } = setup();

    feed(
      "retry: 3000\n",
      "retry: 3s\n",
      "retry: -1\n",
      "retry:\n",
      "retry: 0\n\n",
    );

    expect(retries).toEqual([3000, 0]);
    expect(events).toEqual([]);
  });

  it("ignores an unknown field", () => {
    const { feed, events } = setup();

    feed("foo: bar\ndata: a\n\n");

    expect(events).toEqual([event("a")]);
  });

  it("reports comments without their colon and one leading space", () => {
    const { feed, comments, events } = setup();

    feed(": connected\n", ":ping\n", ":  two spaces\n\n");

    expect(comments).toEqual(["connected", "ping", " two spaces"]);
    expect(events).toEqual([]);
  });

  it("works without comment and retry handlers", () => {
    const events: SseEvent[] = [];
    const parser = createSseParser({ onEvent: (e) => events.push(e) });

    parser.feed(": ping\nretry: 10\ndata: a\n\n");

    expect(events).toEqual([event("a")]);
  });

  it("never dispatches an event whose blank line never came", () => {
    const { feed, events } = setup();

    feed("data: a\n\n", "data: unfinished\n");
    feed("");

    expect(events.map((e) => e.data)).toEqual(["a"]);
  });
});
