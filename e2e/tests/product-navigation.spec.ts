// Moving between the catalog and a product with React Router: a card opens
// the product at /produk/<slug>, and "Kembali" and the brand go back to
// the catalog at /.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  countApiRequests,
  expectNoProblems,
  fetchAllProducts,
  fetchProduct,
  PAGE_SIZE,
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

const catalogHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Katalog" });

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
  // A new page: the focus leaves the card for the page itself.
  await expect(page.locator("main")).toBeFocused();
  // The catalog is gone, not hidden below the product.
  await expect(productSection(page)).toHaveCount(0);

  // The product was fetched by its slug, once.
  expect(calls.get(`/v1/products/${product.slug}`)).toEqual([
    `GET /v1/products/${product.slug}`,
  ]);
  expectNoProblems(problems);
});

test("Kembali returns to the catalog, which loads its first page again", async ({
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

  await openProduct(page, last?.name ?? "");
  await expect(detail(page, last?.name ?? "")).toBeVisible();
  await backLink(page).click();

  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(catalogHeading(page)).toBeFocused();
  await expect(detail(page, last?.name ?? "")).toHaveCount(0);
  // The catalog was unmounted with the route: it starts again at page 1.
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  expect(calls.get("/v1/products")).toHaveLength(listCalls + 1);
  expectNoProblems(problems);
});

test("the GoShop brand also returns to the catalog", async ({ page }) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("teh-hijau-melati-50-kantong");

  await page.goto("/");
  await openProduct(page, product.name);
  await expect(detail(page, product.name)).toBeVisible();

  await brandLink(page).click();
  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Katalog — GoShop");
  await expect(catalogHeading(page)).toBeFocused();
  await expect(productCards(page)).toHaveCount(PAGE_SIZE);
  await expect(detail(page, product.name)).toHaveCount(0);
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
