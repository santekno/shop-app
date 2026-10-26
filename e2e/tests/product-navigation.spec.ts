// Moving between the catalog and a product without a router: a card opens
// the product, "Kembali" and the brand go back, and the catalog, hidden
// rather than unmounted, keeps every page the buyer already loaded.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  countApiRequests,
  expectNoProblems,
  fetchAllProducts,
  fetchProduct,
  loadEverything,
  openProduct,
  productCards,
  productSection,
  rupiah,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

const backButton = (page: Page) =>
  page.getByRole("button", { name: "← Kembali ke katalog" });

const detail = (page: Page, name: string) =>
  page.getByRole("article", { name, exact: true });

const cardButton = (page: Page, name: string) =>
  productSection(page).getByRole("button", { name, exact: true });

const scrollY = (page: Page): Promise<number> =>
  page.evaluate(() => window.scrollY);

/**
 * Opens the card named name, which must sit far down the page, and returns
 * where the page was scrolled when the buyer clicked it.
 */
const openFarDown = async (page: Page, name: string): Promise<number> => {
  const button = cardButton(page, name);
  await button.scrollIntoViewIfNeeded();
  const before = await scrollY(page);
  expect(before, `${name} is far down the catalog`).toBeGreaterThan(
    page.viewportSize()?.height ?? 0,
  );
  await button.click();
  await expect(detail(page, name)).toBeVisible();
  // The product page starts at the top.
  expect(await scrollY(page)).toBe(0);
  return before;
};

/**
 * Back on the catalog, the buyer is where they left: focus on the card's
 * button, the card on screen, and the page scrolled about as far as before
 * (focus scrolls only as much as it needs, so not to the exact pixel).
 */
const expectBackAtCard = async (
  page: Page,
  name: string,
  before: number,
): Promise<void> => {
  const button = cardButton(page, name);
  await expect(button).toBeFocused();
  await expect(button).toBeInViewport();
  const after = await scrollY(page);
  expect(Math.abs(after - before)).toBeLessThan(
    page.viewportSize()?.height ?? 0,
  );
};

test("a card opens its product, with the title and focus on Kembali", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const product = await fetchProduct("kopi-arabika-gayo-250g");
  const first = product.variants.find((v) => v.stock > 0);

  await page.goto("/");
  await openProduct(page, product.name);

  const article = detail(page, product.name);
  await expect(article).toBeVisible();
  await expect(
    article.getByRole("heading", { level: 2, name: product.name }),
  ).toBeVisible();
  await expect(article.getByText(product.category.name)).toBeVisible();
  await expect(article.getByText(product.description)).toBeVisible();
  await expect(article.locator(".price--large")).toHaveText(
    rupiah(first?.price.amount ?? 0),
  );
  await expect(page).toHaveTitle(`${product.name} — GoShop`);
  // The card the keyboard was on is gone; focus moves to the way back.
  await expect(backButton(page)).toBeFocused();
  // The catalog is hidden, not shown below the product.
  await expect(productSection(page)).toBeHidden();

  // The product was fetched by its slug, once.
  expect(calls.get(`/v1/products/${product.slug}`)).toEqual([
    `GET /v1/products/${product.slug}`,
  ]);
  expectNoProblems(problems);
});

test("Kembali returns to the catalog with every loaded page still there", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const calls = countApiRequests(page, BROWSER_API_URL);
  const all = (await fetchAllProducts()).flat();
  const last = all.at(-1);
  expect(last, "the catalog has products").toBeDefined();

  await page.goto("/");
  await loadEverything(page);
  await expect(productCards(page)).toHaveCount(all.length);
  const listCalls = calls.get("/v1/products")?.length ?? 0;

  // The last card is only there because of "Muat lebih banyak".
  const before = await openFarDown(page, last?.name ?? "");
  await backButton(page).click();
  await expectBackAtCard(page, last?.name ?? "", before);

  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(productSection(page)).toBeVisible();
  await expect(productCards(page)).toHaveCount(all.length);
  await expect(
    productSection(page).getByText("Semua produk sudah ditampilkan."),
  ).toBeVisible();
  await expect(detail(page, last?.name ?? "")).toHaveCount(0);
  // Nothing was fetched again: not page 1, not the categories.
  expect(calls.get("/v1/products")).toHaveLength(listCalls);
  expect(calls.get("/v1/categories")).toHaveLength(1);
  expectNoProblems(problems);
});

test("the GoShop brand also returns to the catalog, at the opened card", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const all = (await fetchAllProducts()).flat();
  // Second to last: far down, and not the card the Kembali test uses.
  const product = all.at(-2);
  expect(product, "the catalog has products").toBeDefined();
  const name = product?.name ?? "";

  await page.goto("/");
  await loadEverything(page);
  const cards = await productCards(page).count();
  const before = await openFarDown(page, name);

  await page
    .getByRole("banner")
    .getByRole("button", { name: "GoShop", exact: true })
    .click();
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(productCards(page)).toHaveCount(cards);
  await expect(detail(page, name)).toHaveCount(0);
  await expectBackAtCard(page, name, before);
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
  await backButton(page).click();

  await openProduct(page, polos.name);
  await expect(detail(page, polos.name)).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Jumlah" }).locator("output"),
  ).toHaveText("1");
  expectNoProblems(problems);
});
