import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retry, sleep } from "./async.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Records whether a promise has settled, without awaiting it. */
const track = (promise: Promise<unknown>) => {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
};

describe("sleep", () => {
  it("resolves after ms and not before", async () => {
    const state = track(sleep(100));

    await vi.advanceTimersByTimeAsync(99);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes its abort listener once the time is up", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const done = sleep(50, controller.signal);
    await vi.advanceTimersByTimeAsync(50);
    await done;

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("rejects at once with the reason of an already-aborted signal", async () => {
    const reason = new Error("gone");
    const controller = new AbortController();
    controller.abort(reason);

    await expect(sleep(1_000, controller.signal)).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects mid-wait when the signal aborts, and clears the timer", async () => {
    const controller = new AbortController();
    const done = sleep(1_000, controller.signal);
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(400);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["a string", "bye"],
    ["a null", null],
    ["a number", 42],
  ])(
    "wraps %s abort reason in an AbortError DOMException",
    async (_, reason) => {
      const before = new AbortController();
      before.abort(reason);
      const error: unknown = await sleep(10, before.signal).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DOMException);
      expect(error).toMatchObject({ name: "AbortError" });

      const during = new AbortController();
      const pending = sleep(10, during.signal).catch((e: unknown) => e);
      during.abort(reason);
      const later: unknown = await pending;
      expect(later).toBeInstanceOf(DOMException);
      expect(later).toMatchObject({ name: "AbortError" });
    },
  );
});

describe("retry", () => {
  const always = () => true;

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws a RangeError for retries = %s without calling fn",
    async (retries) => {
      const fn = vi.fn(() => Promise.resolve("never"));

      await expect(
        retry(fn, { retries, delayMs: 10, shouldRetry: always }),
      ).rejects.toThrow(RangeError);
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it("returns the first success without waiting", async () => {
    const fn = vi.fn((attempt: number) => Promise.resolve(`ok ${attempt}`));

    await expect(
      retry(fn, { retries: 3, delayMs: 10, shouldRetry: always }),
    ).resolves.toBe("ok 0");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("numbers the attempts from 0 and waits delay × 2^n between them", async () => {
    const calls: { attempt: number; at: number }[] = [];
    const start = Date.now();
    const fn = (attempt: number) => {
      calls.push({ attempt, at: Date.now() - start });
      return attempt < 3
        ? Promise.reject(new Error(`fail ${attempt}`))
        : Promise.resolve("done");
    };

    const result = retry(fn, { retries: 3, delayMs: 100, shouldRetry: always });
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe("done");
    expect(calls).toEqual([
      { attempt: 0, at: 0 },
      { attempt: 1, at: 100 },
      { attempt: 2, at: 300 },
      { attempt: 3, at: 700 },
    ]);
  });

  it("rethrows the last error when the retries run out", async () => {
    const fn = vi.fn((attempt: number) =>
      Promise.reject(new Error(`fail ${attempt}`)),
    );

    const result = retry(fn, { retries: 2, delayMs: 10, shouldRetry: always });
    const rejected = expect(result).rejects.toThrow("fail 2");
    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("tries once when retries is 0", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("once")));

    await expect(
      retry(fn, { retries: 0, delayMs: 10, shouldRetry: always }),
    ).rejects.toThrow("once");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops when shouldRetry says no and rethrows that error", async () => {
    const permanent = new Error("permanent");
    const fn = vi.fn((attempt: number) =>
      Promise.reject(attempt === 0 ? new Error("transient") : permanent),
    );
    const shouldRetry = vi.fn((error: unknown) => error !== permanent);

    const result = retry(fn, { retries: 5, delayMs: 10, shouldRetry });
    const rejected = expect(result).rejects.toBe(permanent);
    await vi.advanceTimersByTimeAsync(1_000);

    await rejected;
    expect(fn).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenLastCalledWith(permanent);
  });

  it("rejects with the abort reason when the signal aborts between attempts", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const fn = vi.fn(() => Promise.reject(new Error("fail")));

    const result = retry(fn, {
      retries: 3,
      delayMs: 100,
      shouldRetry: always,
      signal: controller.signal,
    });
    const rejected = expect(result).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(50);
    controller.abort(reason);

    await rejected;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
