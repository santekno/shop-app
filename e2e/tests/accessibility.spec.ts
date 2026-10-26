// An accessibility smoke test of the catalog and the product page: every
// button has a name, the variant picker and the stepper are named groups,
// and the stepper's buttons are disabled at their bounds.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchProduct,
  loadEverything,
  openProduct,
} from "../support/catalog.ts";

/** Every visible button on the page has an accessible name. */
const expectNamedButtons = async (page: Page): Promise<number> => {
  const buttons = await page.getByRole("button").all();
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    await expect(button).toHaveAccessibleName(/\S/);
  }
  return buttons.length;
};

test("every button in the catalog and on a product page has a name", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.goto("/");
  await loadEverything(page);
  // Brand, one per product card, and no unnamed icon button.
  expect(await expectNamedButtons(page)).toBeGreaterThan(1);
  // The page has one top-level heading and the sections are named.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Kategori" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Produk" })).toBeVisible();

  await openProduct(page, "Kaos Polos Hitam");
  expect(await expectNamedButtons(page)).toBeGreaterThan(1);
  expectNoProblems(problems);
});

test("the variant picker is a labelled radio group with named options", async ({
  page,
}) => {
  const product = await fetchProduct("kaos-polos-hitam");
  await page.goto("/");
  await openProduct(page, product.name);

  const picker = page.getByRole("group", { name: "Pilih varian" });
  await expect(picker).toBeVisible();
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(product.variants.length);
  for (const [index, variant] of product.variants.entries()) {
    // The label names the radio: the variant, its price and stock.
    await expect(radios.nth(index)).toHaveAccessibleName(
      new RegExp(`^${variant.name}\\b`),
    );
  }
  // One group: the arrow keys move between the options.
  await radios.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(1)).toBeChecked();
});

test("the stepper is a named group whose buttons stop at their bounds", async ({
  page,
}) => {
  // Kemeja Batik Parang XL has exactly one in stock: both buttons are at
  // a bound at once.
  const product = await fetchProduct("kemeja-batik-parang");
  const xl = product.variants.find((v) => v.name === "XL");
  expect(xl?.stock).toBe(1);

  await page.goto("/");
  await openProduct(page, product.name);
  const stepper = page.getByRole("group", { name: "Jumlah" });
  const minus = stepper.getByRole("button", { name: "Kurangi jumlah" });
  const plus = stepper.getByRole("button", { name: "Tambah jumlah" });
  await expect(minus).toBeDisabled();
  await expect(plus).toBeEnabled();

  await page.getByRole("radio", { name: /^XL/ }).check();
  await expect(stepper.locator("output")).toHaveText("1");
  await expect(minus).toBeDisabled();
  await expect(plus).toBeDisabled();
});
