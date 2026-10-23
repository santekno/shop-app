// The storefront when the API is down: the api container is stopped for
// real, so the browser's fetch fails the way it does in production (no
// answer at all), and started again to check that "Coba lagi" recovers
// without a page reload.
import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  API_URL,
  BROWSER_API_URL,
  compose,
  waitForOk,
} from "../support/stack.ts";

/**
 * How the browser reports a stopped API: refused where nothing listens on
 * the port, reset where Docker's port forwarder (colima, Docker Desktop)
 * still accepts the connection and then drops it.
 */
const DOWN = /net::ERR_CONNECTION_(REFUSED|RESET|CLOSED)/;

/** apps/web/src/lib/api.ts: per-attempt timeout, retries and first backoff. */
const TIMEOUT_MS = 5000;
const RETRIES = 2;
const RETRY_DELAY_MS = 300;
/** The backoff alone: 300 ms before the first retry, 600 ms before the second. */
const BACKOFF_MS = RETRY_DELAY_MS * (2 ** RETRIES - 1);
/** The longest a load can take if every attempt ran into the timeout. */
const WORST_CASE_MS = (RETRIES + 1) * TIMEOUT_MS + BACKOFF_MS;

/** One failed call to GET /v1/categories, and when Playwright saw it fail. */
interface Failure {
  errorText: string;
  at: number;
}

/**
 * Checks one load's failed attempts: every one failed at once, and the
 * client waited its backoff in between.
 *
 * An attempt that ran into the client's timeout is aborted by its
 * AbortController, so the browser reports net::ERR_ABORTED, which DOWN
 * rejects. The span from the first failure to the last is the backoff plus
 * the later attempts, so one of those waiting for the timeout makes it at
 * least TIMEOUT_MS + BACKOFF_MS. Measured between failures, it leaves out
 * page.goto and the page's start-up, which a slow runner may stretch.
 */
const expectQuickFailures = (failures: readonly Failure[]): void => {
  expect(failures).toHaveLength(RETRIES + 1);
  for (const { errorText } of failures) expect(errorText).toMatch(DOWN);
  const span = (failures.at(-1)?.at ?? 0) - (failures[0]?.at ?? 0);
  expect(span).toBeLessThan(TIMEOUT_MS + BACKOFF_MS);
};

/** Loads or reloads, and returns how long it took until "Coba lagi" showed. */
const timeToError = async (
  start: () => Promise<unknown>,
  retry: Locator,
): Promise<number> => {
  const startedAt = Date.now();
  await start();
  // Long enough even for the worst case, so a slow failure is reported by
  // expectQuickFailures, not as a missing button.
  await expect(retry).toBeVisible({ timeout: WORST_CASE_MS + 5000 });
  return Date.now() - startedAt;
};

test("shows the error state while the API is down and recovers on Coba lagi", async ({
  page,
}) => {
  // Stopping takes a few seconds (the API drains), starting until healthy
  // a few more.
  test.setTimeout(180_000);
  const problems = await watchBrowser(page);
  const section = page.getByRole("region", { name: "Kategori" });
  const retry = section.getByRole("button", { name: "Coba lagi" });
  const failedCalls: Failure[] = [];
  page.on("requestfailed", (request) => {
    if (request.url() === `${BROWSER_API_URL}/v1/categories`) {
      failedCalls.push({
        errorText: request.failure()?.errorText ?? "",
        at: Date.now(),
      });
    }
  });

  compose("stop", "api");
  try {
    // The error state comes after the backoff, never before it.
    const firstLoad = await timeToError(() => page.goto("/"), retry);
    expect(firstLoad).toBeGreaterThanOrEqual(BACKOFF_MS);
    const alert = section.getByRole("alert");
    await expect(alert).toContainText("Tidak dapat terhubung ke server GoShop");
    await expect(retry).toBeVisible();
    // No response, so no request ID to quote.
    await expect(alert).not.toContainText("Kode permintaan");
    await expect(section.getByRole("list")).toHaveCount(0);
    // The storefront's client retries a GET twice on a network error, so
    // the error state follows the third failed attempt.
    // A stopped API refuses or drops the connection at once, so no
    // attempt waited for the 5 s timeout.
    await expect.poll(() => failedCalls.length).toBe(RETRIES + 1);
    expectQuickFailures(failedCalls);

    // Still down: trying again ends in the same error, not in a stuck
    // loading state.
    const reload = await timeToError(async () => {
      await retry.click();
      await expect(section.getByRole("status")).toHaveText("Memuat kategori…");
    }, retry);
    expect(reload).toBeGreaterThanOrEqual(BACKOFF_MS);
    await expect.poll(() => failedCalls.length).toBe(2 * (RETRIES + 1));
    expectQuickFailures(failedCalls.slice(RETRIES + 1));
  } finally {
    compose("start", "api");
    await waitForOk(`${API_URL}/readyz`);
  }

  await retry.click();
  await expect(section.getByRole("list").first()).toBeVisible();
  expect(failedCalls).toHaveLength(2 * (RETRIES + 1));
  await expect(section.getByRole("alert")).toHaveCount(0);
  await expect(section.getByText("Pakaian", { exact: true })).toBeVisible();

  // While the API was down the browser logs one "Failed to load resource"
  // per attempt (three per load: the first try and two retries). Those are
  // the outage itself; any other console error is a bug.
  const unexpected = problems.consoleErrors.filter(
    (text) => !(text.startsWith("Failed to load resource") && DOWN.test(text)),
  );
  expect(unexpected).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
});
