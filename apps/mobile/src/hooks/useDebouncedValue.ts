import { useEffect, useState } from "react";

/**
 * `value`, but only after it has stopped changing for `delayMs`.
 *
 * Every change starts a timer and cancels the one before it (the effect's
 * cleanup), so a burst of changes, such as the keystrokes of a search,
 * produces one new value at the end of the burst instead of one per
 * change. The first render returns `value` itself, so a field that starts
 * with text does not wait to show it.
 *
 * Unmounting clears the pending timer: no state is set on a screen that is
 * gone.
 *
 * @example
 *   const [text, setText] = useState("");
 *   const settled = useDebouncedValue(text, 300);
 *   // `settled` follows `text` 300 ms after the last keystroke.
 */
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
};
