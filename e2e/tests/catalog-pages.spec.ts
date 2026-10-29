// The catalog's pages against the real, seeded API: the first page,
// rendered by the server (Bab 11 artikel 09), then "Muat lebih banyak"
// following next_cursor from the browser until the end, with every product
// shown once and in the API's order.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  FIRST_PAGE_QUERY,
  PAGE_SIZE,
  SEEDED_SLUGS,
  asHtml,
  countApiRequests,
  disableAutoLoad,
  expectNoProblems,
  fetchAllProducts,
  productCards,
  productSection,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** The names on the cards, in order. */
const cardNames = (page: Page) =>
  productCards(page).locator(".product-card__name").allTextContents();

test("shows the first page from the server, then loads more until every product is there", async ({
  page,
  request,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const pages = await fetchAllProducts();
  const all = pages.flat();
  // The seed alone fills three pages (12 + 12 + 4); the test needs at
  // least two to prove that "Muat lebih banyak" follows the cursor.
  expect(pages.length).toBeGreaterThanOrEqual(2);
  expect(all.map((p) => p.slug)).toEqual(
    expect.arrayContaining([...SEEDED_SLUGS]),
  );

  // The first page is in the HTML itself, before any JavaScript runs.
  const html = await (await request.get("/")).text();
  for (const product of pages[0] ?? []) {
    expect(html, product.name).toContain(asHtml(product.name));
  }

  // The button path: with the automatic loading off, only a click loads
  // the next page, so each round below is one click and one page.
  await disableAutoLoad(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  const section = productSection(page);
  const more = section.getByRole("button", { name: "Muat lebih banyak" });
  const done = section.getByText("Semua produk sudah ditampilkan.");

  // Page 1: exactly the API's first page, in its order.
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  expect(await cardNames(page)).toEqual(pages[0]?.map((p) => p.name));

  for (const [index, apiPage] of pages.slice(1).entries()) {
    // Disabled while the list refetches in the background: never clicked
    // then.
    await expect(more).toBeEnabled();
    await expect(done).toHaveCount(0);
    await more.click();
    const shown = pages
      .slice(0, index + 2)
      .flat()
      .map((p) => p.name);
    await expect(productCards(page)).toHaveCount(shown.length);
    // The new page is appended after the old one, not swapped in.
    expect(await cardNames(page)).toEqual(shown);
    expect(apiPage.length).toBeGreaterThan(0);
  }

  // The end: no button, the end message, every product exactly once.
  await expect(done).toBeVisible();
  await expect(more).toHaveCount(0);
  const names = await cardNames(page);
  expect(names).toHaveLength(all.length);
  expect(new Set(names).size).toBe(names.length);

  // The browser asked for none of the first page (the server's data came
  // with the HTML), and once for each later page, with the cursor of the
  // page before it.
  const productCalls = calls.get("/v1/products") ?? [];
  expect(productCalls).toHaveLength(pages.length - 1);
  for (const call of productCalls) {
    expect(call).toMatch(
      new RegExp(`^GET /v1/products\\?${FIRST_PAGE_QUERY}&cursor=[^&]+$`),
    );
  }
  expect(new Set(productCalls).size).toBe(productCalls.length);
  expectNoProblems(problems);
});
