// The product page's choices against real products: the variant picker
// starts on the first variant in stock, and the quantity stepper is capped
// by the variant's stock and by 99, with the subtotal following both.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import type { ProductRow } from "../support/catalog.ts";
import {
  expectNoProblems,
  fetchProduct,
  openProduct,
  rupiah,
} from "../support/catalog.ts";

/** The most a buyer may put in for one variant (quantity.ts). */
const MAX_QUANTITY = 99;

const controls = (page: Page, product: ProductRow) => {
  const article = page.getByRole("article", { name: product.name });
  const stepper = article.getByRole("group", { name: "Jumlah" });
  return {
    article,
    picker: article.getByRole("group", { name: "Pilih varian" }),
    stepper,
    value: stepper.locator("output"),
    minus: stepper.getByRole("button", { name: "Kurangi jumlah" }),
    plus: stepper.getByRole("button", { name: "Tambah jumlah" }),
    price: article.locator(".price--large"),
    subtotal: article.getByText("Subtotal:").locator("strong"),
  };
};

/** The variant with this name; fails the test when the seed changed. */
const variantNamed = (product: ProductRow, name: string) => {
  const variant = product.variants.find((v) => v.name === name);
  expect(variant, `${product.slug} has a variant ${name}`).toBeDefined();
  return variant ?? { name, stock: 0, price: { amount: 0, currency: "IDR" } };
};

test("the default variant is the first one in stock, not a sold-out one", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("rengginang-terasi-250g");
  // The seed's first variant (250 g) is sold out.
  expect(product.variants[0]?.stock).toBe(0);
  const inStock = product.variants.find((v) => v.stock > 0);

  await page.goto("/");
  await openProduct(page, product.name);
  const { picker, price, value, subtotal } = controls(page, product);

  await expect(picker.getByRole("radio")).toHaveCount(product.variants.length);
  await expect(
    picker.getByRole("radio", { name: new RegExp(`^${inStock?.name ?? ""}`) }),
  ).toBeChecked();
  await expect(picker.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(
    picker.locator("label", { hasText: product.variants[0]?.name ?? "" }),
  ).toContainText("stok habis");
  await expect(price).toHaveText(rupiah(inStock?.price.amount ?? 0));
  await expect(value).toHaveText("1");
  await expect(subtotal).toHaveText(rupiah(inStock?.price.amount ?? 0));

  // Choosing the sold-out variant shows the badge instead of the stepper.
  await picker
    .getByRole("radio", {
      name: new RegExp(`^${product.variants[0]?.name ?? ""}`),
    })
    .check();
  await expect(controls(page, product).article.locator(".badge")).toHaveText(
    "Stok habis",
  );
  await expect(controls(page, product).stepper).toHaveCount(0);
  expectNoProblems(problems);
});

test("only the variants the API sells are offered (no archived ones)", async ({
  page,
}) => {
  const product = await fetchProduct("kaos-polos-hitam");
  await page.goto("/");
  await openProduct(page, product.name);
  const { picker } = controls(page, product);
  // The archived XXL is not in the API's list, so not in the picker.
  expect(product.variants.map((v) => v.name)).not.toContain("XXL");
  await expect(picker.locator(".variant-picker__name")).toHaveText(
    product.variants.map((v) => v.name),
  );
});

test("the stepper stops at the stock, and the subtotal follows", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kaos-oversize-abu-abu");
  const m = variantNamed(product, "M");

  await page.goto("/");
  await openProduct(page, product.name);
  const { picker, value, minus, plus, subtotal, stepper } = controls(
    page,
    product,
  );
  await expect(picker.getByRole("radio", { name: /^M/ })).toBeChecked();
  await expect(minus).toBeDisabled();
  await expect(stepper).toContainText(`Maks. ${m.stock}`);

  for (let n = 2; n <= m.stock; n++) {
    await plus.click();
    await expect(value).toHaveText(String(n));
    await expect(subtotal).toHaveText(rupiah(m.price.amount * n));
  }
  await expect(plus).toBeDisabled();
  await expect(minus).toBeEnabled();

  await minus.click();
  await expect(value).toHaveText(String(m.stock - 1));
  await expect(plus).toBeEnabled();
  expectNoProblems(problems);
});

test("switching to a variant with less stock clamps the quantity", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kaos-oversize-abu-abu");
  const m = variantNamed(product, "M");
  const xl = variantNamed(product, "XL");
  expect(xl.stock).toBeLessThan(m.stock);

  await page.goto("/");
  await openProduct(page, product.name);
  const { picker, value, plus, price, subtotal, stepper } = controls(
    page,
    product,
  );
  for (let n = 2; n <= xl.stock + 2; n++) await plus.click();
  await expect(value).toHaveText(String(xl.stock + 2));

  await picker.getByRole("radio", { name: /^XL/ }).check();
  await expect(value).toHaveText(String(xl.stock));
  await expect(plus).toBeDisabled();
  await expect(stepper).toContainText(`Maks. ${xl.stock}`);
  await expect(price).toHaveText(rupiah(xl.price.amount));
  await expect(subtotal).toHaveText(rupiah(xl.price.amount * xl.stock));
  expectNoProblems(problems);
});

test("switching back after a clamp keeps the clamped quantity", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kaos-oversize-abu-abu");
  const m = variantNamed(product, "M");
  const xl = variantNamed(product, "XL");
  expect(xl.stock).toBeLessThan(m.stock);

  await page.goto("/");
  await openProduct(page, product.name);
  const { picker, value, plus, price, subtotal } = controls(page, product);

  // M at its maximum.
  for (let n = 2; n <= m.stock; n++) await plus.click();
  await expect(value).toHaveText(String(m.stock));
  await expect(plus).toBeDisabled();

  // XL holds less, so the quantity is clamped to XL's stock …
  await picker.getByRole("radio", { name: /^XL/ }).check();
  await expect(value).toHaveText(String(xl.stock));

  // … and stays clamped on the way back: the stored quantity changed, the
  // display did not just hide M's old value.
  await picker.getByRole("radio", { name: /^M/ }).check();
  await expect(value).toHaveText(String(xl.stock));
  await expect(plus).toBeEnabled();
  await expect(price).toHaveText(rupiah(m.price.amount));
  await expect(subtotal).toHaveText(rupiah(m.price.amount * xl.stock));
  expectNoProblems(problems);
});

test("the stepper stops at 99 when the stock is larger", async ({ page }) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("casing-silikon-bening");
  const only = product.variants[0];
  expect(only?.stock).toBeGreaterThan(MAX_QUANTITY);
  const amount = only?.price.amount ?? 0;

  await page.goto("/");
  await openProduct(page, product.name);
  const { value, plus, subtotal, stepper } = controls(page, product);
  await expect(stepper).toContainText(`Maks. ${MAX_QUANTITY}`);
  for (let n = 2; n <= MAX_QUANTITY; n++) await plus.click();
  await expect(value).toHaveText(String(MAX_QUANTITY));
  await expect(plus).toBeDisabled();
  await expect(subtotal).toHaveText(rupiah(amount * MAX_QUANTITY));
  expectNoProblems(problems);
});
