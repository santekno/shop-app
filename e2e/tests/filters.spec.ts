// The catalog's filters live in the URL (?kategori=, ?q=, ?urut=): choosing
// one updates the address and reloads the list from the API with the
// matching query, a reload or a shared link shows the same list, Back
// returns to the previous filter, and a URL the API cannot serve falls
// back cleanly instead of breaking the page.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  disableAutoLoad,
  expectNoProblems,
  fetchAllProducts,
  productCards,
  productSection,
} from "../support/catalog.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** The query of every GET /v1/products the page sends, as plain objects. */
const listQueries = (page: Page): Record<string, string>[] => {
  const queries: Record<string, string>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.url().startsWith(`${BROWSER_API_URL}/v1/products?`)) {
      queries.push(Object.fromEntries(url.searchParams));
    }
  });
  return queries;
};

/** The names on the first page's cards, in order. */
const firstPageNames = (page: Page) =>
  productCards(page).locator(".product-card__name").allTextContents();

const categories = (page: Page) =>
  page.getByRole("region", { name: "Kategori" });

test.beforeEach(async ({ page }) => {
  // One page per list, so each list is exactly the API's first page.
  await disableAutoLoad(page);
});

test("a category link filters the list through the URL, and Back undoes it", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const queries = listQueries(page);
  const [pakaian = []] = await fetchAllProducts({
    category: "pakaian",
    sort: "newest",
  });

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(12);
  await categories(page)
    .getByRole("link", { name: "Pakaian", exact: true })
    .click();

  await expect(page).toHaveURL("/?kategori=pakaian");
  await expect(productCards(page)).toHaveCount(pakaian.length);
  expect(await firstPageNames(page)).toEqual(pakaian.map((p) => p.name));
  // A parent category includes its children's products.
  expect(new Set(pakaian.map((p) => p.category.slug))).toEqual(
    new Set(["kaos", "kemeja", "celana"]),
  );
  expect(queries.at(-1)).toEqual({
    category: "pakaian",
    sort: "newest",
    limit: "12",
  });
  await expect(
    categories(page).getByRole("link", { name: "Pakaian", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    categories(page).getByRole("link", { name: "Semua produk" }),
  ).not.toHaveAttribute("aria-current", "true");

  // Back: the unfiltered list again, from the cache.
  const requestsBefore = queries.length;
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(productCards(page)).toHaveCount(12);
  await expect(
    categories(page).getByRole("link", { name: "Semua produk" }),
  ).toHaveAttribute("aria-current", "true");
  expect(queries).toHaveLength(requestsBefore);
  expectNoProblems(problems);
});

test("sort and search update the URL and the list, and survive a reload", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const queries = listQueries(page);
  const [cheapest = []] = await fetchAllProducts({ sort: "price_asc" });
  const [kopi = []] = await fetchAllProducts({ q: "kopi", sort: "price_asc" });
  expect(kopi.length).toBeGreaterThan(0);

  await page.goto("/");
  await expect(productCards(page)).toHaveCount(12);

  const sort = productSection(page).getByLabel("Urutkan");
  // As a keyboard user would: the select has the focus while it changes.
  await sort.focus();
  await sort.selectOption({ label: "Harga terendah" });
  await expect(page).toHaveURL("/?urut=termurah");
  await expect
    .poll(() => firstPageNames(page))
    .toEqual(cheapest.map((p) => p.name));
  expect(queries.at(-1)).toEqual({ sort: "price_asc", limit: "12" });
  // A change of query string leaves the focus on the control in use.
  await expect(sort).toBeFocused();

  const search = productSection(page).getByRole("searchbox", {
    name: "Cari produk",
  });
  await search.fill("kopi");
  await search.press("Enter");
  await expect(page).toHaveURL("/?q=kopi&urut=termurah");
  await expect(
    productSection(page).getByText("Hasil pencarian untuk “kopi”."),
  ).toBeVisible();
  await expect
    .poll(() => firstPageNames(page))
    .toEqual(kopi.map((p) => p.name));
  expect(queries.at(-1)).toEqual({ q: "kopi", sort: "price_asc", limit: "12" });

  // A reload (or the same link shared) shows the same list and controls.
  await page.reload();
  await expect(productCards(page)).toHaveCount(kopi.length);
  expect(await firstPageNames(page)).toEqual(kopi.map((p) => p.name));
  await expect(sort).toHaveValue("price_asc");
  await expect(search).toHaveValue("kopi");
  expectNoProblems(problems);
});

test("a search that matches nothing says so", async ({ page }) => {
  const problems = await watchBrowser(page);
  await page.goto("/?q=zzzz-tidak-ada-barang-ini");
  await expect(
    productSection(page).getByText("Tidak ada produk yang cocok."),
  ).toBeVisible();
  await expect(productCards(page)).toHaveCount(0);
  expectNoProblems(problems);
});

test("an unknown category offers the whole catalog instead of an error", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const queries = listQueries(page);
  await page.goto("/?kategori=sepatu-terbang");

  const section = productSection(page);
  await expect(section.getByText("Kategori ini tidak ada.")).toBeVisible();
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(queries.at(-1)).toEqual({
    category: "sepatu-terbang",
    sort: "newest",
    limit: "12",
  });
  await section.getByRole("link", { name: "Lihat semua produk" }).click();
  await expect(page).toHaveURL("/");
  await expect(productCards(page)).toHaveCount(12);

  // The API's 400 UNKNOWN_CATEGORY is the answer under test; Chrome logs
  // the failed resource load for it, and nothing else may appear.
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 400",
      ),
  );
  expect(problems.consoleErrors.length - unexpected.length).toBe(1);
  expectNoProblems({ ...problems, consoleErrors: unexpected });
});

test("filters the URL cannot express are ignored, not sent to the API", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const queries = listQueries(page);
  // Not a slug, an unknown sort and a search of only spaces.
  await page.goto("/?kategori=Bukan%20Slug!&urut=acak&q=%20%20%20");

  await expect(productCards(page)).toHaveCount(12);
  expect(queries).toEqual([{ sort: "newest", limit: "12" }]);
  await expect(productSection(page).getByLabel("Urutkan")).toHaveValue(
    "newest",
  );
  await expect(
    categories(page).getByRole("link", { name: "Semua produk" }),
  ).toHaveAttribute("aria-current", "true");
  expectNoProblems(problems);
});
