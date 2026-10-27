/**
 * How the payment page asks the API again while an order waits for its
 * payment (Bab 11 artikel 05).
 *
 * - Often at first, when the answer is most likely to change: a buyer who
 *   comes back from Midtrans has usually just paid, and Midtrans' webhook
 *   arrives within seconds. Then slower and slower (a Fibonacci-like
 *   backoff), up to once every 30 seconds: a virtual account can stay
 *   unpaid for hours, and a page left open must not ask every 2 seconds
 *   all that time.
 * - Never while the tab is hidden (TanStack Query's
 *   refetchIntervalInBackground is false), and at once when it is shown
 *   again (refetchOnWindowFocus, with no staleTime for this query).
 * - Not for ever: after POLL_LIMIT_MS the page stops by itself and offers
 *   "Periksa lagi", which starts a new round.
 * - Not after a final answer: paid or cancelled can no longer change by
 *   themselves.
 */
export const POLL_DELAYS_MS = [
  2_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000,
] as const;

/** How long one round of polling lasts. */
export const POLL_LIMIT_MS = 15 * 60 * 1_000;

/** The wait before the next check, after `answers` answers so far. */
export const pollDelay = (answers: number): number =>
  POLL_DELAYS_MS[
    Math.min(Math.max(answers - 1, 0), POLL_DELAYS_MS.length - 1)
  ] ?? 30_000;
