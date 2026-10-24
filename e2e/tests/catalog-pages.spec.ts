// The catalog's pages against the real, seeded API: the first page, then
// "Muat lebih banyak" following next_cursor until the end, with every
// product shown once and in the API's order.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  FIRST_PAGE_QUERY,
  PAGE_SIZE,
  SEEDED_SLUGS,
  countApiRequests,
  expectNoProblems,
  fetchAllProducts,
  productCards,
  productSection,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** The names on the cards, in order. */
const cardNames = (page: Page) =>
  productCards(page).locator(".product-card__name").allTextContents();

test("shows the first page, then loads more until every product is there", async ({
  page,
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

  await page.goto("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  const section = productSection(page);
  const more = section.getByRole("button", { name: "Muat lebih banyak" });
  const done = section.getByText("Semua produk sudah ditampilkan.");

  // Page 1: exactly the API's first page, in its order.
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  expect(await cardNames(page)).toEqual(pages[0]?.map((p) => p.name));

  for (const [index, apiPage] of pages.slice(1).entries()) {
    await expect(more).toBeVisible();
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

  // One request per page: the first without a cursor, each later one with
  // the cursor of the page before it.
  const productCalls = calls.get("/v1/products") ?? [];
  expect(productCalls).toHaveLength(pages.length);
  expect(productCalls[0]).toBe(`GET /v1/products?${FIRST_PAGE_QUERY}`);
  for (const call of productCalls.slice(1)) {
    expect(call).toMatch(
      new RegExp(`^GET /v1/products\\?${FIRST_PAGE_QUERY}&cursor=[^&]+$`),
    );
  }
  expect(new Set(productCalls).size).toBe(productCalls.length);
  expectNoProblems(problems);
});
