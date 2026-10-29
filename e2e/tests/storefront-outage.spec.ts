// The storefront when the API is down: the api container is stopped for
// real, so every fetch fails the way it does in production (no answer at
// all), and started again to check that the page recovers. Since Bab 11
// the storefront's server fetches first (artikel 09): the catalog's
// failed server fetch is swallowed and the browser asks again, so each
// "Coba lagi" still recovers its own part of the page without a reload; a
// product page the server cannot fetch is an error page (HTTP 500), never
// a 200 or a 404 a crawler would index. What the server has fetched before
// stays in its data cache and is served through an outage, so each test
// starts a fresh web container (an empty cache: each container keeps its
// own, artikel 14).
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { clientNavigate, watchBrowser } from "../support/browser.ts";
import type { BrowserProblems } from "../support/browser.ts";
import {
  PAGE_SIZE,
  disableAutoLoad,
  fetchAllProducts,
  productCards,
  productSection,
} from "../support/catalog.ts";
import {
  API_URL,
  BROWSER_API_URL,
  WEB_URL,
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

/**
 * Recreates the web container, so its data cache is empty: the server
 * then has to ask the API for every page, as on a fresh deploy.
 */
const freshWeb = async (): Promise<void> => {
  compose("up", "-d", "--no-deps", "--force-recreate", "--wait", "web");
  await waitForOk(`${WEB_URL}/healthz`);
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

  // No automatic loading, so "Muat lebih banyak" stays on screen once
  // the first page is back.
  await disableAutoLoad(page);
  await freshWeb();

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
  ).toBeEnabled();
  await expect(products.getByRole("alert")).toHaveCount(0);
  await expect(categories.getByRole("alert")).toBeVisible();

  await retryCategories.click();
  await expect(categories.getByText("Pakaian", { exact: true })).toBeVisible();
  await expect(categories.getByRole("alert")).toHaveCount(0);

  expect(failedCount(failures, "/v1/categories")).toBe(2 * attempts);
  expect(failedCount(failures, "/v1/products")).toBe(attempts);
  expectOnlyOutageErrors(problems);
});

test("a product the server cannot fetch is an error page, and a reload shows it once the API is back", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = await watchBrowser(page);
  // The last product of the catalog: not on its first page, so neither
  // the catalog nor a prefetch made the fresh server fetch it.
  const product = (await fetchAllProducts()).flat().at(-1);
  expect(product, "the catalog has products").toBeDefined();
  const name = product?.name ?? "";
  const path = `/produk/${product?.slug ?? ""}`;
  await freshWeb();

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Terjadi kesalahan",
  });
  const reload = page.getByRole("button", { name: "Muat ulang halaman" });

  await withApiDown(async () => {
    // Inside the app: the router asks the server for the page, whose
    // fetch fails, and app/error.tsx renders in its place.
    await clientNavigate(page, path);
    await expect(heading).toBeVisible({ timeout: WORST_CASE_MS + 5000 });
    await expect(page).toHaveURL(path);
    await expect(page).toHaveTitle("Terjadi kesalahan — GoShop");
    await expect(heading).toBeFocused();
    await expect(reload).toBeVisible();
    // The way back is there while the product does not load.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Kembali ke katalog" }),
    ).toHaveAttribute("href", "/");

    // Loaded directly: HTTP 500, so a search engine retries later instead
    // of indexing an error or dropping the product as missing.
    const response = await page.request.get(path);
    expect(response.status()).toBe(500);
  });

  // Back up: the error page's reload renders the product from the server.
  await reload.click();
  await expect(page.getByRole("article", { name })).toBeVisible();
  await expect(page).toHaveTitle(`${name} — GoShop`);
  await expect(heading).toHaveCount(0);
  // The browser saw the server's 500 (the router's request), React's report
  // of the server's error (error #441: a Server Components error, its
  // message withheld in production), once logged by React and once by
  // reportCaughtError, and the stopped API (the session check). Nothing
  // else may appear.
  const reactReports = problems.consoleErrors.filter((text) =>
    text.startsWith("Error: Minified React error #441;"),
  );
  expect(reactReports).toHaveLength(2);
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !reactReports.includes(text) &&
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 500",
      ),
  );
  expectOnlyOutageErrors({ ...problems, consoleErrors: unexpected });
});
