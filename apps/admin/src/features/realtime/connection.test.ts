import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenSource } from "@/features/auth/auth-client.ts";
import { endFrame, fetchStream, openStream } from "@/test/msw/events.ts";
import {
  FAILURES_BEFORE_UNREACHABLE,
  RETRY_BACKOFF,
  SHUTDOWN_SPREAD_MS,
  STABLE_AFTER_MS,
  TOO_MANY_STREAMS_BACKOFF,
  createEventConnection,
} from "./connection.ts";
import type { ConnectionStatus } from "./connection.ts";
import type { SseEvent } from "./sse-parser.ts";

// The connection's rules run on timers (backoff, idle, stable-after), so
// these tests drive a fake clock and hand the connection a `fetch` of
// their own: one scripted answer per attempt. Fake timers and MSW 3's
// socket interception do not mix (event-stream.test.ts covers the real
// request through MSW).

type Attempt = (init: RequestInit | undefined) => Promise<Response>;

/** The stream opens and stays open until the test closes it. */
const opens = (stream = openStream()): Attempt => {
  stream.push(": connected\n\n");
  return (init) => fetchStream(stream)("", init);
};

/** The stream opens, sends `chunks`, then closes. */
const sends = (...chunks: string[]): Attempt => {
  const stream = openStream();
  for (const chunk of chunks) stream.push(chunk);
  stream.close();
  return (init) => fetchStream(stream)("", init);
};

/** The API refuses the stream. */
const refuses =
  (status: number, code: string): Attempt =>
  () =>
    Promise.resolve(
      Response.json({ error: { code, message: "no" } }, { status }),
    );

/** The network fails. */
const unreachable: Attempt = () => Promise.reject(new TypeError("offline"));

const setup = ({
  attempts,
  random = () => 0,
  tokens: tokenOverrides = {},
}: {
  attempts: Attempt[];
  random?: () => number;
  tokens?: Partial<TokenSource>;
}) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const session = { token: "t1" };
  const tokens: TokenSource = {
    ensureFreshToken: vi.fn(() =>
      Promise.resolve<string | null>(session.token),
    ),
    refreshAfterUnauthorized: vi.fn(() => {
      session.token = `t${String(Number(session.token.slice(1)) + 1)}`;
      return Promise.resolve<string | null>(session.token);
    }),
    refreshAfterForbidden: vi.fn(() => Promise.resolve()),
    ...tokenOverrides,
  };
  const statuses: ConnectionStatus[] = [];
  const events: SseEvent[] = [];
  const bearers: (string | null)[] = [];
  const onOpen = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    bearers.push(new Headers(init?.headers).get("Authorization"));
    const next = attempts.shift();
    if (next === undefined) return new Promise(() => undefined);
    return next(init);
  });
  const connection = createEventConnection({
    url: "http://api.test/v1/admin/events",
    tokens,
    onOpen,
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    fetch,
    random,
    now: () => Date.now(),
  });
  /** Lets every promise and timer due within `ms` run. */
  const elapse = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  return {
    connection,
    tokens,
    statuses,
    events,
    bearers,
    onOpen,
    fetch,
    elapse,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createEventConnection", () => {
  it("connects, goes live and hands over events", async () => {
    const { connection, statuses, events, onOpen, bearers, elapse } = setup({
      attempts: [sends(": connected\n\n", "id: 1\nevent: order\ndata: {}\n\n")],
    });

    connection.start();
    await elapse();
    connection.stop();

    expect(statuses.slice(0, 2)).toEqual(["connecting", "live"]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "order", data: "{}", lastEventId: "1" }]);
    expect(bearers).toEqual(["Bearer t1"]);
  });

  it("does nothing on a second start", async () => {
    const { connection, fetch, elapse } = setup({ attempts: [opens()] });

    connection.start();
    connection.start();
    await elapse();

    expect(fetch).toHaveBeenCalledTimes(1);
    connection.stop();
  });

  it("backs off 1, 2, 4 … seconds after closes and failures, and says 'Terputus' after three", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [
        sends(),
        unreachable,
        refuses(503, "UNAVAILABLE"),
        unreachable,
      ],
    });

    connection.start();
    await elapse();
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);

    // random() = 0: the lower half of each window, 0.5, 1, 2 s.
    await elapse(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await elapse(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await elapse(999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await elapse(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await elapse(2_000);
    expect(fetch).toHaveBeenCalledTimes(4);

    expect(FAILURES_BEFORE_UNREACHABLE).toBe(3);
    expect(statuses).toEqual([
      "connecting",
      "live",
      "reconnecting",
      "reconnecting",
      "unreachable",
      "unreachable",
    ]);
    connection.stop();
  });

  it("never waits longer than 30 seconds", async () => {
    const attempts = Array.from({ length: 8 }, () => unreachable);
    const { connection, fetch, elapse } = setup({ attempts, random: () => 1 });

    connection.start();
    await elapse(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000);
    expect(fetch).toHaveBeenCalledTimes(7);
    await elapse(30_000);

    expect(RETRY_BACKOFF).toEqual({ baseMs: 1_000, capMs: 30_000 });
    expect(fetch).toHaveBeenCalledTimes(8);
    connection.stop();
  });

  it("refreshes the token and reconnects at once after `end: token_expired`", async () => {
    const { connection, tokens, statuses, bearers, elapse } = setup({
      attempts: [sends(endFrame("token_expired")), opens()],
    });

    connection.start();
    await elapse();

    expect(tokens.refreshAfterUnauthorized).toHaveBeenCalledExactlyOnceWith(
      "t1",
    );
    expect(bearers).toEqual(["Bearer t1", "Bearer t2"]);
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "live"]);
    connection.stop();
  });

  it("stops with 'ended' when the refresh after token_expired ends the session", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [sends(endFrame("token_expired")), opens()],
      tokens: { refreshAfterUnauthorized: () => Promise.resolve(null) },
    });

    connection.start();
    await elapse(60_000);

    expect(statuses.at(-1)).toBe("ended");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("backs off when that refresh fails for another reason", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [sends(endFrame("token_expired")), opens()],
      tokens: {
        refreshAfterUnauthorized: () => Promise.reject(new Error("500")),
      },
    });

    connection.start();
    await elapse();
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(fetch).toHaveBeenCalledTimes(1);
    await elapse(500);

    expect(fetch).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it("reconnects within a second, spread by jitter, after `end: shutdown`", async () => {
    const { connection, fetch, statuses, elapse } = setup({
      attempts: [sends(endFrame("shutdown")), opens()],
      random: () => 0.25,
    });

    connection.start();
    await elapse(249);
    expect(fetch).toHaveBeenCalledTimes(1);
    await elapse(1);

    expect(SHUTDOWN_SPREAD_MS).toBe(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "live"]);
    connection.stop();
  });

  it("treats an end it does not know like a close", async () => {
    const { connection, fetch, elapse } = setup({
      attempts: [sends(endFrame("maintenance")), opens()],
    });

    connection.start();
    await elapse(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await elapse(1);

    expect(fetch).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it("reconnects after 60 s of silence, the connection being dead", async () => {
    const { connection, fetch, statuses, elapse } = setup({
      attempts: [opens(), opens()],
    });

    connection.start();
    await elapse(59_999);
    expect(statuses).toEqual(["connecting", "live"]);
    await elapse(1);
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
    await elapse(500);

    expect(fetch).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it("refreshes once after a 401 and reconnects at once; a second 401 in a row backs off", async () => {
    const { connection, tokens, fetch, bearers, elapse } = setup({
      attempts: [
        refuses(401, "UNAUTHORIZED"),
        refuses(401, "UNAUTHORIZED"),
        opens(),
      ],
    });

    connection.start();
    await elapse();
    expect(bearers).toEqual(["Bearer t1", "Bearer t2"]);
    expect(tokens.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    await elapse(500);
    expect(tokens.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    connection.stop();
  });

  it("allows a refresh after a 401 again once a stream has opened", async () => {
    const { connection, tokens, elapse } = setup({
      attempts: [
        refuses(401, "UNAUTHORIZED"),
        sends(),
        refuses(401, "UNAUTHORIZED"),
        opens(),
      ],
    });

    connection.start();
    await elapse(500);

    expect(tokens.refreshAfterUnauthorized).toHaveBeenCalledTimes(2);
    connection.stop();
  });

  it("stops with 'forbidden' on a 403 and never tries again", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [refuses(403, "FORBIDDEN"), opens()],
    });

    connection.start();
    await elapse(10 * 60_000);

    expect(statuses).toEqual(["connecting", "forbidden"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits 30 s to 2 min after a 429, saying there are too many streams", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [
        refuses(429, "TOO_MANY_STREAMS"),
        refuses(429, "TOO_MANY_STREAMS"),
        opens(),
      ],
    });

    connection.start();
    await elapse();
    expect(statuses).toEqual(["connecting", "too-many-streams"]);
    await elapse(14_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await elapse(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // The second wait doubles: 30 s at random() = 0.
    await elapse(29_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await elapse(1);

    expect(TOO_MANY_STREAMS_BACKOFF).toEqual({
      baseMs: 30_000,
      capMs: 120_000,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    connection.stop();
  });

  it("starts the backoff over after a stream that stayed open 10 s", async () => {
    const stable = openStream();
    const { connection, fetch, elapse } = setup({
      attempts: [unreachable, unreachable, opens(stable), opens()],
    });

    connection.start();
    await elapse(500 + 1_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await elapse(STABLE_AFTER_MS);
    stable.close();
    await elapse(499);
    expect(fetch).toHaveBeenCalledTimes(3);
    await elapse(1);

    // Without the reset the wait would have been 2 s (third failure).
    expect(fetch).toHaveBeenCalledTimes(4);
    connection.stop();
  });

  it("keeps backing off after a stream that closed within 10 s", async () => {
    const short = openStream();
    const { connection, fetch, elapse } = setup({
      attempts: [unreachable, unreachable, opens(short), opens()],
    });

    connection.start();
    await elapse(500 + 1_000);
    await elapse(STABLE_AFTER_MS - 1);
    short.close();
    await elapse(1_999);
    expect(fetch).toHaveBeenCalledTimes(3);
    await elapse(1);

    expect(fetch).toHaveBeenCalledTimes(4);
    connection.stop();
  });

  it.each([
    ["has no token (no session)", () => Promise.resolve(null)],
    ["finds the session over", () => Promise.reject(new Error("401"))],
  ])(
    "stops with 'ended', sending nothing, when ensureFreshToken %s",
    async (_name, ensure) => {
      const { connection, statuses, fetch, elapse } = setup({
        attempts: [opens()],
        tokens: { ensureFreshToken: ensure },
      });

      connection.start();
      await elapse(60_000);

      expect(statuses).toEqual(["connecting", "ended"]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("closes the stream on stop and reports nothing after", async () => {
    const stream = openStream();
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [opens(stream), opens()],
    });
    connection.start();
    await elapse();
    const signal = fetch.mock.calls[0]?.[1]?.signal;

    connection.stop();
    await elapse(120_000);

    expect(signal?.aborted).toBe(true);
    expect(statuses).toEqual(["connecting", "live"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops during a wait without another attempt", async () => {
    const { connection, statuses, fetch, elapse } = setup({
      attempts: [unreachable, opens()],
    });
    connection.start();
    await elapse();

    connection.stop();
    await elapse(120_000);

    expect(statuses).toEqual(["connecting", "reconnecting"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retryNow cuts a wait short and starts the backoff over", async () => {
    const { connection, fetch, elapse } = setup({
      attempts: [unreachable, unreachable, unreachable, unreachable, opens()],
    });
    connection.start();
    await elapse(500 + 1_000 + 2_000);
    expect(fetch).toHaveBeenCalledTimes(4);

    // Waiting 4 s now; "Coba lagi" tries at once.
    connection.retryNow();
    await elapse();
    expect(fetch).toHaveBeenCalledTimes(5);
    connection.stop();
  });

  it("retryNow resets the failure count, so the next wait is short again", async () => {
    const { connection, fetch, elapse } = setup({
      attempts: [unreachable, unreachable, unreachable, unreachable, opens()],
    });
    connection.start();
    await elapse(500 + 1_000);
    expect(fetch).toHaveBeenCalledTimes(3);

    connection.retryNow();
    await elapse();
    expect(fetch).toHaveBeenCalledTimes(4);
    await elapse(499);
    expect(fetch).toHaveBeenCalledTimes(4);
    await elapse(1);

    expect(fetch).toHaveBeenCalledTimes(5);
    connection.stop();
  });

  it("retryNow leaves a live stream alone", async () => {
    const stream = openStream();
    const { connection, fetch, statuses, events, elapse } = setup({
      attempts: [opens(stream), opens()],
    });
    connection.start();
    await elapse();

    connection.retryNow();
    await elapse();
    stream.push("data: still here\n\n");
    await elapse();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(statuses).toEqual(["connecting", "live"]);
    expect(events.map((event) => event.data)).toEqual(["still here"]);
    connection.stop();
  });
});
