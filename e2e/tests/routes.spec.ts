// The storefront's routes against the real API: every page answers its
// own URL (deep links), Back and Forward move between pages with the focus
// where a keyboard user expects it, and an unknown URL shows the 404 page.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { clientNavigate, watchBrowser } from "../support/browser.ts";
import {
  cardOpener,
  expectNoProblems,
  fetchProduct,
  openProduct,
  productCards,
} from "../support/catalog.ts";

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

test("every page answers its own URL, with its heading and title", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kaos-polos-hitam");
  const pages: [string, string, string][] = [
    ["/", "Katalog", "Katalog — GoShop"],
    [`/produk/${product.slug}`, product.name, `${product.name} — GoShop`],
    ["/keranjang", "Keranjang", "Keranjang — GoShop"],
    ["/masuk", "Masuk", "Masuk — GoShop"],
    ["/daftar", "Daftar akun", "Daftar — GoShop"],
  ];
  for (const [url, name, title] of pages) {
    await page.goto(url);
    await expect(heading(page, name), url).toBeVisible();
    await expect(page, url).toHaveTitle(title);
    // One page, one top-level heading.
    await expect(page.getByRole("heading", { level: 1 }), url).toHaveCount(1);
  }
  // The header marks the page the buyer is on.
  await expect(
    page.getByRole("navigation", { name: "Utama" }).getByRole("link", {
      name: "Daftar",
    }),
  ).toHaveAttribute("aria-current", "page");
  expectNoProblems(problems);
});

test("an unknown URL shows the 404 page, and its link leads home", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();

  // Followed inside the app: Next.js' router asks the server for the URL,
  // and since no route matches it, loads it as a new page (Bab 7–10's
  // React Router rendered its 404 route in place). The server answers
  // HTTP 404 with the not-found page.
  const load = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "document" &&
      new URL(response.url()).pathname === "/tidak-ada/sama-sekali",
  );
  await clientNavigate(page, "/tidak-ada/sama-sekali");
  expect((await load).status()).toBe(404);
  const notFound = heading(page, "Halaman tidak ditemukan");
  await expect(notFound).toBeVisible();
  await expect(page).toHaveTitle("Halaman tidak ditemukan — GoShop");
  await expect(page.getByText("Alamat ini tidak ada di GoShop.")).toBeVisible();
  // A page load, so the focus starts at the top, where the first Tab
  // reaches the skip link.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Langsung ke konten utama" }),
  ).toBeFocused();

  await page
    .getByRole("main")
    .getByRole("link", { name: "Kembali ke katalog" })
    .click();
  // A route change inside the app: the focus moves to the new heading.
  await expect(page).toHaveURL("/");
  await expect(heading(page, "Katalog")).toBeFocused();

  // Loaded directly, the server renders the same page, with status 404
  // (Bab 7–10's SPA fallback answered 200).
  const response = await page.goto("/tidak-ada");
  expect(response?.status()).toBe(404);
  await expect(notFound).toBeVisible();
  await expect(page).toHaveTitle("Halaman tidak ditemukan — GoShop");
  // Chrome logs each 404 answer (the router's request, the two page loads)
  // as a failed resource load: the answers under test. Nothing else.
  expectNoProblems({
    ...problems,
    consoleErrors: problems.consoleErrors.filter(
      (text) =>
        !text.startsWith(
          "Failed to load resource: the server responded with a status of 404",
        ),
    ),
  });
});

test("Back and Forward move between the catalog and a product, focus included", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kopi-arabika-gayo-250g");

  await page.goto("/");
  await openProduct(page, product.name);
  const productHeading = heading(page, product.name);
  await expect(productHeading).toBeFocused();

  // Back: the catalog, with the focus on the card the buyer opened.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(cardOpener(page, product.name)).toBeFocused();

  // Forward: the product again, from the cache, with its heading focused.
  await page.goForward();
  await expect(page).toHaveURL(`/produk/${product.slug}`);
  await expect(productHeading).toBeFocused();
  await expect(page).toHaveTitle(`${product.name} — GoShop`);
  expectNoProblems(problems);
});

test("a product link with a modifier key leaves the current page alone", async ({
  page,
  context,
}) => {
  const product = await fetchProduct("teh-hijau-melati-50-kantong");
  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();

  // A real link: Ctrl/Cmd+click opens a new tab, as with any website.
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    cardOpener(page, product.name).click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(new RegExp(`/produk/${product.slug}$`));
  await expect(heading(tab, product.name)).toBeVisible();
  await expect(page).toHaveURL("/");
  await tab.close();
});
