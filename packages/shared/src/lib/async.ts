/**
 * Why `signal` was aborted, as an Error. `controller.abort()` sets a
 * DOMException named "AbortError"; `controller.abort(value)` may set any
 * value, which is wrapped so a rejection is always an Error.
 */
const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("This operation was aborted", "AbortError");

/**
 * Waits `ms` milliseconds without blocking: other code keeps running, and the
 * returned promise settles later. If `signal` aborts first, the promise
 * rejects with the signal's reason and the timer is cleared.
 *
 * The Go equivalent is a select on two channels:
 *
 *   select {
 *   case <-time.After(d):
 *   case <-ctx.Done():
 *       return ctx.Err()
 *   }
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      if (signal) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export interface RetryOptions {
  /** Extra attempts after the first one fails: 0 tries once, 2 up to three times. */
  retries: number;
  /** Wait before the first retry, doubled before each later one (300, 600, 1200 …). */
  delayMs: number;
  /** Whether an error is worth another attempt. A false answer rethrows it at once. */
  shouldRetry: (error: unknown) => boolean;
  /** Aborting it stops the waiting between attempts. */
  signal?: AbortSignal;
}

/**
 * Calls `fn` until it succeeds, it fails with an error `shouldRetry` rejects,
 * or the retries run out; then the last error is thrown. `fn` receives the
 * attempt number, starting at 0.
 *
 * `async` makes the function return a promise; `await` pauses this function
 * (not the thread) until the promise settles. The loop reads like the Go
 * version with time.Sleep, but while it waits the browser keeps rendering.
 */
export const retry = async <T>(
  fn: (attempt: number) => Promise<T>,
  { retries, delayMs, shouldRetry, signal }: RetryOptions,
): Promise<T> => {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError(`retries must be a whole number >= 0, got ${retries}`);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      // `return await`, not `return`: without await a rejected promise would
      // leave this try block before the catch below could see it.
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
    }
    await sleep(delayMs * 2 ** attempt, signal);
  }
};
