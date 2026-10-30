import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Wraps `callback` so that a burst of calls runs it once, `delayMs` after
 * the last one, with the last call's arguments: typing "kaos" calls
 * `run` four times and the callback once. Go's equivalent is a
 * `time.AfterFunc` that every new call stops and starts again.
 *
 * - `run(...args)` (re)starts the wait.
 * - `cancel()` drops a call still waiting (pressing Enter runs the search
 *   at once instead).
 * - A call still waiting when the component unmounts is dropped, so the
 *   callback never runs for a page that is gone.
 *
 * `run` and `cancel` keep their identity across renders, and the callback
 * that runs is always the latest one passed in: it is kept in a ref,
 * updated after each render, so a waiting call never runs a stale
 * closure.
 */
export const useDebouncedCallback = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
) => {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  // Cleanup on unmount: drop a call still waiting.
  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (...args: Args) => {
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        callbackRef.current(...args);
      }, delayMs);
    },
    [cancel, delayMs],
  );

  return { run, cancel };
};
