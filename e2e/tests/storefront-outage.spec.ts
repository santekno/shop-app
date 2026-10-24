// The storefront when the API is down: the api container is stopped for
// real, so the browser's fetch fails the way it does in production (no
// answer at all), and started again to check that each "Coba lagi"
// recovers its own part of the page without a reload.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import type { BrowserProblems } from "../support/browser.ts";
import {
  PAGE_SIZE,
  openProduct,
  productCards,
  productSection,
} from "../support/catalog.ts";
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

/** Records the page's failed API calls, per path (the query left out). */
const recordFailures = (page: Page): Map<string, Failure[]> => {
  const failures = new Map<string, Failure[]>();
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(`${BROWSER_API_URL}/`)) return;
    const path = new URL(request.url()).pathname;
    const list = failures.get(path) ?? [];
    list.push({
      errorText: request.failure()?.errorText ?? "",
      at: Date.now(),
    });
    failures.set(path, list);
  });
  return failures;
};

/** How many calls to path have failed so far. */
const failedCount = (failures: Map<string, Failure[]>, path: string) =>
  failures.get(path)?.length ?? 0;

/**
 * Fails on anything but the outage itself: the browser logs one "Failed to
 * load resource" per failed attempt, and any other console error is a bug.
 */
const expectOnlyOutageErrors = (problems: BrowserProblems): void => {
  const unexpected = problems.consoleErrors.filter(
    (text) => !(text.startsWith("Failed to load resource") && DOWN.test(text)),
  );
  expect(unexpected).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
};

/** Stops the api container for run, and always starts it again. */
const withApiDown = async (run: () => Promise<void>): Promise<void> => {
  compose("stop", "api");
  try {
    await run();
  } finally {
    compose("start", "api");
    await waitForOk(`${API_URL}/readyz`);
  }
};

test("the catalog's two sections fail on their own and each Coba lagi recovers its own", async ({
  page,
}) => {
  // Stopping takes a few seconds (the API drains), starting until healthy
  // a few more.
  test.setTimeout(180_000);
  const problems = await watchBrowser(page);
  const failures = recordFailures(page);
  const categories = page.getByRole("region", { name: "Kategori" });
  const products = productSection(page);
  const retryCategories = categories.getByRole("button", { name: "Coba lagi" });
  const retryProducts = products.getByRole("button", { name: "Coba lagi" });
  const attempts = RETRIES + 1;

  await withApiDown(async () => {
    // The error state comes after the backoff, never before it.
    const firstLoad = await timeToError(() => page.goto("/"), retryCategories);
    expect(firstLoad).toBeGreaterThanOrEqual(BACKOFF_MS);
    await expect(retryProducts).toBeVisible({ timeout: WORST_CASE_MS });

    for (const section of [categories, products]) {
      const alert = section.getByRole("alert");
      await expect(alert).toContainText(
        "Tidak dapat terhubung ke server GoShop",
      );
      // No response, so no request ID to quote.
      await expect(alert).not.toContainText("Kode permintaan");
    }
    await expect(categories.getByRole("list")).toHaveCount(0);
    await expect(productCards(page)).toHaveCount(0);
    await expect(
      products.getByRole("button", { name: "Muat lebih banyak" }),
    ).toHaveCount(0);

    // Per endpoint, the client tried three times (the first try and two
    // retries), and a stopped API fails each attempt at once, so none
    // waited for the 5 s timeout.
    for (const path of ["/v1/categories", "/v1/products"]) {
      await expect.poll(() => failedCount(failures, path)).toBe(attempts);
      expectQuickFailures(failures.get(path) ?? []);
    }

    // Still down: retrying the categories ends in the same error, and
    // leaves the products alone.
    const reload = await timeToError(async () => {
      await retryCategories.click();
      await expect(categories.getByRole("status")).toHaveText(
        "Memuat kategori…",
      );
    }, retryCategories);
    expect(reload).toBeGreaterThanOrEqual(BACKOFF_MS);
    await expect
      .poll(() => failedCount(failures, "/v1/categories"))
      .toBe(2 * attempts);
    expectQuickFailures(failures.get("/v1/categories")?.slice(attempts) ?? []);
    expect(failedCount(failures, "/v1/products")).toBe(attempts);
  });

  // Back up: the products' Coba lagi loads the first page, and only that.
  await retryProducts.click();
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  await expect(
    products.getByRole("button", { name: "Muat lebih banyak" }),
  ).toBeVisible();
  await expect(products.getByRole("alert")).toHaveCount(0);
  await expect(categories.getByRole("alert")).toBeVisible();

  await retryCategories.click();
  await expect(categories.getByText("Pakaian", { exact: true })).toBeVisible();
  await expect(categories.getByRole("alert")).toHaveCount(0);

  expect(failedCount(failures, "/v1/categories")).toBe(2 * attempts);
  expect(failedCount(failures, "/v1/products")).toBe(attempts);
  expectOnlyOutageErrors(problems);
});

test("a product that cannot be loaded shows the error, and Coba lagi loads it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = await watchBrowser(page);
  const failures = recordFailures(page);

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  const name =
    (await productCards(page)
      .first()
      .locator(".product-card__name")
      .textContent()) ?? "";
  const productPage = page.locator(".product-page");
  const retry = productPage.getByRole("button", { name: "Coba lagi" });
  let path = "";

  await withApiDown(async () => {
    const elapsed = await timeToError(() => openProduct(page, name), retry);
    expect(elapsed).toBeGreaterThanOrEqual(BACKOFF_MS);
    await expect(productPage.getByRole("alert")).toContainText(
      "Tidak dapat terhubung ke server GoShop",
    );
    // The way back is there while the product does not load, and the
    // focus is on the new page.
    await expect(
      page.getByRole("link", { name: "← Kembali ke katalog" }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeFocused();

    const productFailures = [...failures.entries()].filter(([p]) =>
      p.startsWith("/v1/products/"),
    );
    expect(productFailures).toHaveLength(1);
    path = productFailures[0]?.[0] ?? "";
    await expect.poll(() => failedCount(failures, path)).toBe(RETRIES + 1);
    expectQuickFailures(failures.get(path) ?? []);
  });

  await retry.click();
  await expect(page.getByRole("article", { name })).toBeVisible();
  await expect(page).toHaveTitle(`${name} — GoShop`);
  await expect(productPage.getByRole("alert")).toHaveCount(0);
  expect(failedCount(failures, path)).toBe(RETRIES + 1);
  // The catalog was loaded before the outage and never failed.
  expect(failedCount(failures, "/v1/products")).toBe(0);
  expectOnlyOutageErrors(problems);
});
