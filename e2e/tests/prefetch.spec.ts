// Prefetch on intent: a mouse resting on a product card for more than
// 100 ms fetches the product's data and its page chunk, so the click that
// follows needs no request at all; a mouse that only sweeps across cards
// fetches nothing; and keyboard focus prefetches at once.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chunkName } from "../support/assets.ts";
import { watchBrowser } from "../support/browser.ts";
import {
  cardOpener,
  expectNoProblems,
  fetchAllProducts,
  productCards,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** Every request for product data or a JS chunk, in order. */
const intentRequests = (page: Page): string[] => {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.url().startsWith(`${BROWSER_API_URL}/v1/products/`)) {
      seen.push(`api ${decodeURIComponent(url.pathname)}`);
    } else {
      const chunk = chunkName(url.pathname);
      if (chunk !== undefined) seen.push(`js ${chunk}`);
    }
  });
  return seen;
};

const openCatalog = async (page: Page) => {
  const [first = []] = await fetchAllProducts({ sort: "newest" });
  expect(first.length).toBeGreaterThanOrEqual(4);
  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  return first;
};

test("a resting hover fetches the product and its chunk, and the click then needs nothing", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const seen = intentRequests(page);
  const [product] = await openCatalog(page);
  const name = product?.name ?? "";
  const slug = product?.slug ?? "";
  seen.length = 0;

  await cardOpener(page, name).hover();
  await expect
    .poll(() => seen)
    .toEqual(
      expect.arrayContaining([
        `api /v1/products/${slug}`,
        "js ProductDetailPage",
      ]),
    );
  expect(seen.filter((line) => line.startsWith("api"))).toEqual([
    `api /v1/products/${slug}`,
  ]);

  // The click: the page shows from the cache and the loaded chunk.
  const before = seen.length;
  await cardOpener(page, name).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  expect(seen.slice(before)).toEqual([]);
  expectNoProblems(problems);
});

test("a quick sweep across the cards fetches nothing", async ({ page }) => {
  const problems = await watchBrowser(page);
  const seen = intentRequests(page);
  const first = await openCatalog(page);
  seen.length = 0;

  const [a, b, c, rest] = first;
  expect(rest).toBeDefined();

  // Across three cards in a row, a few milliseconds on each.
  for (const product of [a, b, c]) {
    if (product === undefined) continue;
    const box = await cardOpener(page, product.name).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
  }
  // Then rest on a fourth card: its prefetch fires 100 ms after the mouse
  // arrived, later than any timer the sweep could have left running, so
  // once its request is seen, a prefetch from the sweep would be too.
  await cardOpener(page, rest?.name ?? "").hover();
  await expect
    .poll(() => seen.filter((line) => line.startsWith("api")))
    .toEqual([`api /v1/products/${rest?.slug ?? ""}`]);
  expectNoProblems(problems);
});

test("keyboard focus on a card prefetches at once", async ({ page }) => {
  const problems = await watchBrowser(page);
  const seen = intentRequests(page);
  const [product] = await openCatalog(page);
  seen.length = 0;

  await cardOpener(page, product?.name ?? "").focus();
  await expect
    .poll(() => seen)
    .toEqual(
      expect.arrayContaining([
        `api /v1/products/${product?.slug ?? ""}`,
        "js ProductDetailPage",
      ]),
    );

  // Enter opens it with nothing left to fetch.
  const before = seen.length;
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: product?.name ?? "" }),
  ).toBeFocused();
  expect(seen.slice(before)).toEqual([]);
  expectNoProblems(problems);
});
