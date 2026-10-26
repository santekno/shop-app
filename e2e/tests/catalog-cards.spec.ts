// Each product card against the API's data: name, category, the price in
// rupiah (with "Mulai" when the variants differ in price) and the sold-out
// badge, with the image placeholder: the seed writes no photos, and the
// storefront ignores the API's images until Bab 11.
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchAllProducts,
  loadEverything,
  productCards,
  rupiah,
} from "../support/catalog.ts";

test("every card shows the API's name, category, rupiah price, Mulai and stock", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const products = (await fetchAllProducts()).flat();

  await page.goto("/");
  await loadEverything(page);
  const cards = productCards(page);
  await expect(cards).toHaveCount(products.length);

  for (const [index, product] of products.entries()) {
    const card = cards.nth(index);
    const label = `card ${index} (${product.slug})`;
    await expect(card.locator(".product-card__name"), label).toHaveText(
      product.name,
    );
    await expect(card.locator("p.muted"), label).toHaveText(
      product.category.name,
    );

    const ranged = product.variants.some(
      (v) => v.price.amount !== product.price_from.amount,
    );
    await expect(card.locator(".price"), label).toHaveText(
      `${ranged ? "Mulai " : ""}${rupiah(product.price_from.amount)}`,
    );
    await expect(card.locator(".badge"), label).toHaveCount(
      product.in_stock ? 0 : 1,
    );
    if (!product.in_stock) {
      await expect(card.locator(".badge"), label).toHaveText("Stok habis");
    }
    // The seed writes no photos. Check that first, so a seed that gains
    // photos fails here by name instead of passing for the wrong reason.
    expect(product.images, `${label} images`).toEqual([]);
    // Without photos: a placeholder that screen readers skip.
    await expect(card.getByText("Belum ada foto"), label).toBeVisible();
    await expect(
      card.locator(".product-image--placeholder"),
      label,
    ).toHaveAttribute("aria-hidden", "true");
  }
  expectNoProblems(problems);
});

test("the seed's known cases render as the data says", async ({ page }) => {
  // Fixed points from apps/api/cmd/seed/catalog.go, so a change in the
  // seed or in the API's price_from rules shows up here by name.
  await page.goto("/");
  await loadEverything(page);
  const card = (name: string) =>
    productCards(page).filter({
      has: page.getByRole("button", { name, exact: true }),
    });

  // All variants 89 000 except XL at 99 000; the archived XXL is not sold.
  await expect(card("Kaos Polos Hitam").locator(".price")).toHaveText(
    `Mulai ${rupiah(89_000)}`,
  );
  // One price for every size: no "Mulai".
  await expect(card("Kaos Polos Putih").locator(".price")).toHaveText(
    rupiah(89_000),
  );
  // Both sizes sold out.
  await expect(
    card("Celana Pendek Kargo Hijau Army").locator(".badge"),
  ).toHaveText("Stok habis");
  // 250 g is sold out but 500 g is not, so the product is in stock.
  await expect(card("Rengginang Terasi 250 g").locator(".badge")).toHaveCount(
    0,
  );
});
