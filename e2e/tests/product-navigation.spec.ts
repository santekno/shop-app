// Moving between the catalog and a product with Next.js' router (Bab 11;
// React Router before): a card opens the product at /produk/<slug>, its
// data rendered by the server, and "Kembali" and the brand go back to the
// catalog at /, which comes back from TanStack Query's cache with every
// page the buyer loaded, the focus on the card they opened, and that card
// on screen.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  countApiRequests,
  expectNoProblems,
  fetchAllProducts,
  fetchProduct,
  PAGE_SIZE,
  cardOpener,
  disableAutoLoad,
  loadEverything,
  openProduct,
  productCards,
  productSection,
  rupiah,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

const backLink = (page: Page) =>
  page.getByRole("link", { name: "← Kembali ke katalog" });

const brandLink = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: "GoShop", exact: true });

const detail = (page: Page, name: string) =>
  page.getByRole("article", { name, exact: true });

const scrollY = (page: Page): Promise<number> =>
  page.evaluate(() => window.scrollY);

/**
 * Opens the card named name, which must sit far down the page, and returns
 * where the page was scrolled when the buyer clicked it.
 */
const openFarDown = async (page: Page, name: string): Promise<number> => {
  const opener = cardOpener(page, name);
  await opener.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before, `${name} is far down the catalog`).toBeGreaterThan(
    page.viewportSize()?.height ?? 0,
  );
  await opener.click();
  await expect(detail(page, name)).toBeVisible();
  // The product page starts at the top.
  expect(await scrollY(page)).toBe(0);
  return before;
};

/**
 * Back on the catalog, the buyer is where they left: focus on the card's
 * link, the card on screen, and the page scrolled about as far as before
 * (not to the exact pixel: focus scrolls only as much as it needs).
 */
const expectBackAtCard = async (
  page: Page,
  name: string,
  before: number,
): Promise<void> => {
  const opener = cardOpener(page, name);
  await expect(opener).toBeFocused();
  await expect(opener).toBeInViewport();
  const after = await scrollY(page);
  expect(Math.abs(after - before)).toBeLessThan(
    page.viewportSize()?.height ?? 0,
  );
};

test("a card opens its product at /produk/<slug>, with its title", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const product = await fetchProduct("kopi-arabika-gayo-250g");
  const first = product.variants.find((v) => v.stock > 0);

  await page.goto("/");
  // The card's name is a real link to the product's URL: it can be opened
  // in a new tab, copied and shared.
  await expect(
    productSection(page).getByRole("link", { name: product.name, exact: true }),
  ).toHaveAttribute("href", `/produk/${product.slug}`);
  await openProduct(page, product.name);
  await expect(page).toHaveURL(`/produk/${product.slug}`);

  const article = detail(page, product.name);
  await expect(article).toBeVisible();
  await expect(
    article.getByRole("heading", { level: 1, name: product.name }),
  ).toBeVisible();
  await expect(article.getByText(product.category.name)).toBeVisible();
  await expect(article.getByText(product.description)).toBeVisible();
  await expect(article.locator(".price--large")).toHaveText(
    rupiah(first?.price.amount ?? 0),
  );
  await expect(page).toHaveTitle(`${product.name} — GoShop`);
  // A new page: the focus leaves the card for the page's heading, which
  // takes it over from <main> once the product has loaded.
  await expect(
    article.getByRole("heading", { level: 1, name: product.name }),
  ).toBeFocused();
  // The catalog is gone, not hidden below the product.
  await expect(productSection(page)).toHaveCount(0);

  // The product came with the page from the server (Bab 11 artikel 09):
  // the browser did not ask the API for it.
  expect(calls.get(`/v1/products/${product.slug}`)).toBeUndefined();
  expectNoProblems(problems);
});

test("Kembali returns to the catalog from the cache, at the opened card", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const all = (await fetchAllProducts()).flat();
  const last = all.at(-1);
  expect(last, "the catalog has products").toBeDefined();
  const name = last?.name ?? "";

  await page.goto("/");
  await loadEverything(page);
  await expect(productCards(page)).toHaveCount(all.length);
  const listCalls = calls.get("/v1/products")?.length ?? 0;

  // The last card is only there because more pages were loaded.
  const before = await openFarDown(page, name);
  await backLink(page).click();

  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expectBackAtCard(page, name, before);
  await expect(productCards(page)).toHaveCount(all.length);
  await expect(
    productSection(page).getByText("Semua produk sudah ditampilkan."),
  ).toBeVisible();
  await expect(detail(page, name)).toHaveCount(0);
  // Within the 30 s stale time nothing is fetched again: not page 1, not
  // the categories (which the server rendered: the browser never asks).
  expect(calls.get("/v1/products")).toHaveLength(listCalls);
  expect(calls.get("/v1/categories")).toBeUndefined();
  expectNoProblems(problems);
});

test("the GoShop brand also returns to the catalog, at the opened card", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const all = (await fetchAllProducts()).flat();
  // Second to last: far down, and not the card the Kembali test uses.
  const product = all.at(-2);
  expect(product, "the catalog has products").toBeDefined();
  const name = product?.name ?? "";

  await page.goto("/");
  await loadEverything(page);
  const cards = await productCards(page).count();
  const listCalls = calls.get("/v1/products")?.length ?? 0;
  const before = await openFarDown(page, name);

  await brandLink(page).click();
  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(productCards(page)).toHaveCount(cards);
  await expect(detail(page, name)).toHaveCount(0);
  await expectBackAtCard(page, name, before);
  expect(calls.get("/v1/products")).toHaveLength(listCalls);
  expectNoProblems(problems);
});

test("a second product opens fresh, without the first one's choices", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const oversize = await fetchProduct("kaos-oversize-abu-abu");
  const polos = await fetchProduct("kaos-polos-putih");

  await page.goto("/");
  await openProduct(page, oversize.name);
  const stepper = page.getByRole("group", { name: "Jumlah" });
  await stepper.getByRole("button", { name: "Tambah jumlah" }).click();
  await expect(stepper.locator("output")).toHaveText("2");
  await backLink(page).click();

  await openProduct(page, polos.name);
  await expect(detail(page, polos.name)).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Jumlah" }).locator("output"),
  ).toHaveText("1");
  expectNoProblems(problems);
});

test("after the 30 s stale time the catalog still shows at once, and refreshes in the background", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const product = await fetchProduct("kopi-arabika-gayo-250g");
  // A clock the test can move: TanStack Query compares Date.now() with
  // when the data arrived.
  await page.clock.install();
  await disableAutoLoad(page);

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  await openProduct(page, product.name);
  await expect(detail(page, product.name)).toBeVisible();
  const lists = calls.get("/v1/products")?.length ?? 0;

  await page.clock.fastForward("00:31");
  await backLink(page).click();
  // The cached list is on screen at once, with no loading state …
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  await expect(productSection(page).getByText("Memuat produk…")).toHaveCount(0);
  // … while the stale list is fetched again behind it. The categories
  // (5 minutes) are still fresh, so the browser still never asked for them.
  await expect.poll(() => calls.get("/v1/products")?.length).toBe(lists + 1);
  expect(calls.get("/v1/categories")).toBeUndefined();
  await expect(cardOpener(page, product.name)).toBeFocused();
  expectNoProblems(problems);
});
