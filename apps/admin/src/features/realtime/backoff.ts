/** The shape of an exponential backoff. */
export interface BackoffPolicy {
  /** The wait before the first retry, before jitter. */
  baseMs: number;
  /** The longest wait, however many attempts have failed. */
  capMs: number;
}

/**
 * The wait before retry number `failures + 1`: `baseMs` doubled per
 * failure, at most `capMs`, then "equal jitter": a random point in the
 * upper half, so the wait is never close to zero and two tabs (or two
 * hundred dashboards after an API restart) do not come back in step.
 *
 *   failures   0      1      2      3      4       5+
 *   wait       0.5–1  1–2    2–4    4–8    8–16    15–30 s   (base 1 s, cap 30 s)
 *
 * `random` is Math.random unless a test passes its own.
 */
export const backoffDelay = (
  failures: number,
  { baseMs, capMs }: BackoffPolicy,
  random: () => number = Math.random,
): number => {
  // 2 ** 30 is already far past any cap; the exponent stops growing there.
  const exponential = Math.min(capMs, baseMs * 2 ** Math.min(failures, 30));
  return exponential / 2 + random() * (exponential / 2);
};
