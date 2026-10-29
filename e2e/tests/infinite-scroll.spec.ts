// The catalog's infinite scroll against the real API: the sentinel below
// the grid loads the next page as it nears the viewport, a failed later
// page keeps the products already shown and retries only that page, and a
// next_cursor the API repeats ends the list instead of looping. The first
// page comes with the HTML (the server fetched it, Bab 11 artikel 09), so
// the browser's requests start at page 2.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import type { BrowserProblems } from "../support/browser.ts";
import {
  PAGE_SIZE,
  disableAutoLoad,
  expectNoProblems,
  fetchAllProducts,
  productCards,
  productSection,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** The cursor of every GET /v1/products the page sends ("" for page 1). */
const listCursors = (page: Page): string[] => {
  const cursors: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(`${BROWSER_API_URL}/v1/products?`)) {
      cursors.push(new URL(request.url()).searchParams.get("cursor") ?? "");
    }
  });
  return cursors;
};

/** Scrolls down with the mouse wheel until the end message shows. */
const scrollToEnd = async (page: Page): Promise<void> => {
  const done = productSection(page).getByText(
    "Semua produk sudah ditampilkan.",
  );
  for (let round = 0; round < 50 && !(await done.isVisible()); round++) {
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(100);
  }
  await expect(done).toBeVisible();
};

const isListRequest = (url: URL, cursor: string | null): boolean =>
  url.href.startsWith(`${BROWSER_API_URL}/v1/products?`) &&
  url.searchParams.get("cursor") === cursor;

test("scrolling to the end loads every page without a click", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const cursors = listCursors(page);
  const pages = await fetchAllProducts({ sort: "newest" });
  const all = pages.flat();
  expect(pages.length).toBeGreaterThanOrEqual(2);
  await page.goto("/");
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  // Scroll only, never a click: each time the end of the grid comes near,
  // the next page arrives by itself.
  await scrollToEnd(page);
  await expect(productCards(page)).toHaveCount(all.length);
  // One request per later page, each with the cursor of the page before
  // it; none for page 1, which the server rendered.
  expect(cursors).toHaveLength(pages.length - 1);
  expect(cursors).not.toContain("");
  expect(new Set(cursors).size).toBe(cursors.length);
  expectNoProblems(problems);
});

/** Fails on anything but the failed page loads this test causes itself. */
const expectOnlyAbortedLoads = (problems: BrowserProblems): void => {
  const unexpected = problems.consoleErrors.filter(
    (text) => !text.startsWith("Failed to load resource: net::ERR_FAILED"),
  );
  expect(unexpected).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
};

test("a later page that fails keeps the list, and Coba lagi fetches only that page", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const cursors = listCursors(page);
  const [first = []] = await fetchAllProducts({ sort: "newest" });
  // The cursor the storefront will send for page 2.
  const firstPage = await fetch(
    `${BROWSER_API_URL}/v1/products?sort=newest&limit=${PAGE_SIZE}`,
  );
  const nextCursor = (
    (await firstPage.json()) as { page: { next_cursor: string } }
  ).page.next_cursor;

  // Page 2 fails at the network until the test lets it through.
  let failPage2 = true;
  let failed = 0;
  await page.route(
    (url) => isListRequest(url, nextCursor),
    async (route) => {
      if (failPage2) {
        failed += 1;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    },
  );

  await disableAutoLoad(page);
  await page.goto("/");
  const section = productSection(page);
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  const more = section.getByRole("button", { name: "Muat lebih banyak" });
  await expect(more).toBeEnabled();
  await more.click();

  const alert = section.getByRole("alert");
  await expect(alert).toContainText("Tidak dapat terhubung ke server GoShop");
  // The first page stays on screen, under it the footer's own retry.
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  expect(
    await productCards(page).locator(".product-card__name").allTextContents(),
  ).toEqual(first.map((p) => p.name));
  await expect(
    section.getByRole("button", { name: "Muat lebih banyak" }),
  ).toHaveCount(0);
  // The API client tried page 2 three times (one try, two retries).
  expect(failed).toBe(3);

  failPage2 = false;
  const before = cursors.length;
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(productCards(page)).toHaveCount(2 * PAGE_SIZE);
  await expect(alert).toHaveCount(0);
  // Only page 2 was asked for again: page 1 was not refetched.
  expect(cursors.slice(before)).toEqual([nextCursor]);
  expectOnlyAbortedLoads(problems);
});

test("a next_cursor the API repeats ends the list instead of loading forever", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const cursors = listCursors(page);
  const firstPage = await fetch(
    `${BROWSER_API_URL}/v1/products?sort=newest&limit=${PAGE_SIZE}`,
  );
  const nextCursor = (
    (await firstPage.json()) as { page: { next_cursor: string } }
  ).page.next_cursor;

  // Page 2 is real, but claims that page 2 comes next again.
  await page.route(
    (url) => isListRequest(url, nextCursor),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        page: { next_cursor: string | null };
      };
      body.page.next_cursor = nextCursor;
      await route.fulfill({ response, json: body });
    },
  );

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  await scrollToEnd(page);
  await expect(productCards(page)).toHaveCount(2 * PAGE_SIZE);
  // Give the sentinel time to misbehave: still exactly one request, for
  // page 2 (page 1 came from the server).
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(500);
  expect(cursors).toEqual([nextCursor]);
  expectNoProblems(problems);
});
