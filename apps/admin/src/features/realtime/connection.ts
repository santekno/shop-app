import { isApiError } from "@goshop/shared";
import type { TokenSource } from "@/features/auth/auth-client.ts";
import { backoffDelay } from "./backoff.ts";
import type { BackoffPolicy } from "./backoff.ts";
import { streamEvents } from "./event-stream.ts";
import type { StreamEnd } from "./event-stream.ts";
import type { SseEvent } from "./sse-parser.ts";

/**
 * Where the connection stands, for the header's indicator:
 *
 * - `connecting`: the first attempt is on its way.
 * - `live`: the stream is open.
 * - `reconnecting`: it closed or failed, and the next attempt is waiting
 *   or on its way.
 * - `unreachable`: several attempts in a row failed; it keeps trying.
 * - `too-many-streams`: 429, the account has 5 streams open on that API
 *   instance (other tabs); it keeps trying, slowly.
 * - `forbidden`: 403, this account may not read the stream. Stopped.
 * - `ended`: the session is over (the refresh was refused). Stopped; the
 *   login page takes over.
 */
export type ConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "unreachable"
  | "too-many-streams"
  | "forbidden"
  | "ended";

/** After a close or a failure: 1, 2, 4 … seconds, at most 30. */
export const RETRY_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 30_000 };
/** After a 429: the other streams will not close in a second; 30 s to 2 min. */
export const TOO_MANY_STREAMS_BACKOFF: BackoffPolicy = {
  baseMs: 30_000,
  capMs: 120_000,
};
/**
 * After `end: shutdown`: the instance is stopping and the next request
 * reaches a healthy one, so reconnect at once, but spread over a second,
 * so every dashboard of the stopped instance does not arrive together.
 */
export const SHUTDOWN_SPREAD_MS = 1_000;
/** Failed attempts in a row before the indicator says "Terputus". */
export const FAILURES_BEFORE_UNREACHABLE = 3;
/**
 * How long a stream must have stayed open for its end to count as normal.
 * A stream that the API opens and closes again at once (it lost Redis
 * every time) still backs off, instead of reconnecting, and refetching
 * the orders, every second.
 */
export const STABLE_AFTER_MS = 10_000;

export interface EventConnectionOptions {
  /** The full URL of GET /v1/admin/events. */
  url: string;
  /** The session's tokens (session-manager.ts), under its refresh lock. */
  tokens: TokenSource;
  /** A stream has opened: what was missed while closed must be refetched. */
  onOpen: () => void;
  /** Every event but `end`. */
  onEvent: (event: SseEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Tests pass fakes for these three. */
  fetch?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

/** What to do after one attempt. */
type Next =
  | { kind: "now" }
  | { kind: "wait"; ms: number; status: ConnectionStatus }
  | { kind: "stop"; status: ConnectionStatus };

/**
 * The connection to the dashboard's event stream, without React: one
 * stream at a time, opened again whenever it ends, until `stop()`.
 *
 * The rules, from the API's contract (ADR 0009, `GET /v1/admin/events`):
 *
 * | What happened                       | What it does                                                    |
 * | ----------------------------------- | --------------------------------------------------------------- |
 * | `end` `token_expired`               | refresh the token (the session's lock), reconnect at once       |
 * | `end` `shutdown`                    | reconnect within a second (spread with jitter)                  |
 * | closed without `end`, network error | back off: 1, 2, 4 … 30 s, with jitter                           |
 * | nothing for 60 s (no heartbeat)     | the same: the connection is dead without anyone saying so       |
 * | 401                                 | refresh once and reconnect at once; a second 401 backs off      |
 * | 403                                 | stop: this account may not have it, retrying will not change it |
 * | 429 `TOO_MANY_STREAMS`              | back off longer: 30 s to 2 min                                  |
 * | the session ended (refresh refused) | stop                                                            |
 *
 * A stream that stayed open for `STABLE_AFTER_MS` starts the backoff over.
 * `retryNow()` starts the backoff over too (the browser came back online,
 * or the user pressed "Coba lagi"): it cuts a wait short, or abandons an
 * attempt whose stream has not opened yet and starts a new one. Offline,
 * an attempt can hang until the 60 s idle timer; the new one goes out on
 * the network as it is now.
 */
export const createEventConnection = ({
  url,
  tokens,
  onOpen,
  onEvent,
  onStatus,
  fetch,
  random = Math.random,
  now = Date.now,
}: EventConnectionOptions) => {
  let controller: AbortController | null = null;
  // Ends the current wait early; null while no wait is running.
  let wake: (() => void) | null = null;
  // Abandons the attempt on its way; null when none is running, and once
  // its stream is open (a live stream is never cut for a retry).
  let abandonAttempt: (() => void) | null = null;
  // Set by retryNow: the next attempt starts the backoff over.
  let freshStart = false;

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
      wake = done;
    });

  const run = async (signal: AbortSignal) => {
    let failures = 0;
    // A 401 gets one refresh-and-reconnect; the next 401 in a row backs off.
    let refreshedAfter401 = false;

    /** The wait after a failure, and the status to show meanwhile. */
    const failed = (): Next => {
      const ms = backoffDelay(failures, RETRY_BACKOFF, random);
      failures++;
      return {
        kind: "wait",
        ms,
        status:
          failures >= FAILURES_BEFORE_UNREACHABLE
            ? "unreachable"
            : "reconnecting",
      };
    };

    /** After the stream's token was refused or expired: a fresh one. */
    const refreshed = async (staleToken: string): Promise<Next> => {
      try {
        const fresh = await tokens.refreshAfterUnauthorized(staleToken);
        return fresh === null
          ? { kind: "stop", status: "ended" }
          : { kind: "now" };
      } catch {
        // The network or a 5xx: the session may still be good.
        return failed();
      }
    };

    const attempt = async (): Promise<Next> => {
      let token: string | null;
      try {
        // A token about to expire is replaced first (proactive refresh),
        // shared with any request asking at the same time.
        token = await tokens.ensureFreshToken();
      } catch {
        // It rejects only when that refresh ended the session.
        return { kind: "stop", status: "ended" };
      }
      if (token === null) return { kind: "stop", status: "ended" };

      // When the stream opened. An object: TypeScript does not see an
      // assignment made in a callback (onOpen) on a plain `let`.
      const stream: { openedAt: number | null } = { openedAt: null };
      const wasStable = () =>
        stream.openedAt !== null && now() - stream.openedAt >= STABLE_AFTER_MS;
      // This attempt's own signal: stop() aborts it (through `signal`),
      // and so does retryNow() until the stream opens.
      const own = new AbortController();
      const forwardStop = () => {
        own.abort();
      };
      signal.addEventListener("abort", forwardStop, { once: true });
      abandonAttempt = () => {
        own.abort();
      };
      // The stream is over, however it ended: nothing left to abandon.
      const settled = () => {
        abandonAttempt = null;
        signal.removeEventListener("abort", forwardStop);
      };
      let end: StreamEnd;
      try {
        end = await streamEvents({
          url,
          accessToken: token,
          signal: own.signal,
          fetch,
          onOpen: () => {
            abandonAttempt = null;
            stream.openedAt = now();
            refreshedAfter401 = false;
            onStatus("live");
            onOpen();
          },
          onEvent,
        });
      } catch (error) {
        settled();
        if (signal.aborted) return { kind: "stop", status: "ended" };
        // Abandoned by retryNow: a new attempt, at once.
        if (own.signal.aborted) return { kind: "now" };
        if (wasStable()) failures = 0;
        if (!isApiError(error)) return failed();
        switch (error.status) {
          case 401:
            if (refreshedAfter401) return failed();
            refreshedAfter401 = true;
            return refreshed(token);
          case 403:
            return { kind: "stop", status: "forbidden" };
          case 429: {
            const ms = backoffDelay(failures, TOO_MANY_STREAMS_BACKOFF, random);
            failures++;
            return { kind: "wait", ms, status: "too-many-streams" };
          }
          default:
            return failed();
        }
      }
      settled();

      if (wasStable()) failures = 0;
      if (end.kind === "end" && end.reason === "token_expired") {
        return refreshed(token);
      }
      if (end.kind === "end" && end.reason === "shutdown") {
        return {
          kind: "wait",
          ms: random() * SHUTDOWN_SPREAD_MS,
          status: "reconnecting",
        };
      }
      // Closed without an end, or an end this client does not know.
      return failed();
    };

    // A function, not `signal.aborted` twice: TypeScript would keep the
    // loop condition's answer across the await, where stop() may run.
    const stopped = () => signal.aborted;
    while (!stopped()) {
      if (freshStart) {
        freshStart = false;
        failures = 0;
      }
      const next = await attempt();
      if (stopped()) return;
      if (next.kind === "stop") {
        onStatus(next.status);
        return;
      }
      if (next.kind === "wait") {
        onStatus(next.status);
        await sleep(next.ms, signal);
      } else {
        onStatus("reconnecting");
      }
    }
  };

  return {
    /** Opens the stream, unless it is already running. */
    start: () => {
      if (controller !== null) return;
      const own = new AbortController();
      controller = own;
      onStatus("connecting");
      void run(own.signal);
    },
    /** Closes the stream and stops reconnecting. Calls no handler after. */
    stop: () => {
      controller?.abort();
      controller = null;
    },
    /**
     * Tries again now, and starts the backoff over: the user asked, or the
     * network is back, so the failures before say little about the next
     * attempt. Ends a wait between two attempts, or abandons an attempt
     * whose stream has not opened yet (it may hang until the idle timer,
     * for instance when it went out while offline) for a new one. Nothing
     * while the stream is live, or after stop().
     */
    retryNow: () => {
      if (wake !== null) {
        freshStart = true;
        wake();
      } else if (abandonAttempt !== null) {
        freshStart = true;
        abandonAttempt();
      }
    },
  };
};

export type EventConnection = ReturnType<typeof createEventConnection>;
