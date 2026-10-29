// Prefetching the products the buyer may open. Bab 9–10 fetched a
// product's data and page chunk when a mouse rested on its card
// (usePrefetchProduct). Since Bab 11 the card is a next/link and the
// product page is rendered by the server, so the job moved: Next.js
// prefetches the route of every product link that comes into view (its
// server payload, as a request with the Next-Router-Prefetch header), and
// opening one then asks the storefront's server for the page, which holds
// the product, and the API for nothing.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  cardOpener,
  countApiRequests,
  expectNoProblems,
  fetchAllProducts,
  productCards,
} from "../support/catalog.ts";
import { BROWSER_API_URL, WEB_URL } from "../support/stack.ts";

/** The product routes Next.js asked its server for, prefetch or not. */
interface RouteRequests {
  prefetched: Set<string>;
  rendered: string[];
}

const routeRequests = (page: Page): RouteRequests => {
  const seen: RouteRequests = { prefetched: new Set(), rendered: [] };
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    // A router request carries the RSC header; a page load does not.
    if (
      !request.url().startsWith(`${WEB_URL}/produk/`) ||
      headers.rsc !== "1"
    ) {
      return;
    }
    const slug = decodeURIComponent(url.pathname.slice("/produk/".length));
    if (headers["next-router-prefetch"] === "1") seen.prefetched.add(slug);
    else seen.rendered.push(slug);
  });
  return seen;
};

const openCatalog = async (page: Page) => {
  const [first = []] = await fetchAllProducts({ sort: "newest" });
  expect(first.length).toBeGreaterThanOrEqual(4);
  // Not disableAutoLoad: Next.js finds the links in view with the same
  // IntersectionObserver the catalog's sentinel uses.
  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  return first;
};

test("the cards in view are prefetched, and a click then needs only the server's page, not the API", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const routes = routeRequests(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const [product] = await openCatalog(page);
  const name = product?.name ?? "";
  const slug = product?.slug ?? "";

  // The first card is on screen as the page loads: prefetched at once,
  // before any hover.
  await expect.poll(() => routes.prefetched.has(slug)).toBe(true);
  expect(routes.rendered).toEqual([]);

  await cardOpener(page, name).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  // One request to the storefront for the page (rendered with the product
  // by the server), none to the API for it.
  expect(routes.rendered).toEqual([slug]);
  expect(calls.get(`/v1/products/${slug}`)).toBeUndefined();
  expectNoProblems(problems);
});

test("a card below the fold is prefetched when it scrolls into view, not before", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const routes = routeRequests(page);
  const first = await openCatalog(page);
  await page.waitForLoadState("networkidle");

  // The last card of the first page, under the fold at this window size.
  const last = first.at(-1);
  const opener = cardOpener(page, last?.name ?? "");
  await expect(opener).not.toBeInViewport();
  expect(routes.prefetched.has(last?.slug ?? "")).toBe(false);

  await opener.scrollIntoViewIfNeeded();
  await expect.poll(() => routes.prefetched.has(last?.slug ?? "")).toBe(true);
  // A prefetch only: nothing was opened.
  expect(routes.rendered).toEqual([]);
  expectNoProblems(problems);
});

test("a card opened from the keyboard needs no API request either", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const routes = routeRequests(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const [product] = await openCatalog(page);
  const name = product?.name ?? "";

  await cardOpener(page, name).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeFocused();
  expect(routes.rendered).toEqual([product?.slug]);
  expect(calls.get(`/v1/products/${product?.slug ?? ""}`)).toBeUndefined();
  expectNoProblems(problems);
});
