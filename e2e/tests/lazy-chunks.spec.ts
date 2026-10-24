// Code splitting in the built image: the catalog loads without the product
// and auth pages' code, and each of those arrives as its own JS chunk the
// first time its route is visited (React Router's lazy routes).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chunkName } from "../support/assets.ts";
import { watchBrowser } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchProduct,
  openProduct,
  productCards,
} from "../support/catalog.ts";

/** The JS files the page loads from /assets/, by name without the hash. */
const scripts = (page: Page): string[] => {
  const names: string[] = [];
  page.on("request", (request) => {
    const name = chunkName(new URL(request.url()).pathname);
    if (name !== undefined) names.push(name);
  });
  return names;
};

test("the product and auth pages each load their own chunk, once, when first opened", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const loaded = scripts(page);
  const product = await fetchProduct("kopi-arabika-gayo-250g");

  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  // The entry chunk only: no page is loaded before it is needed.
  expect(loaded).toContain("index");
  for (const lazy of ["ProductDetailPage", "LoginPage", "RegisterPage"]) {
    expect(loaded, `${lazy} before its route`).not.toContain(lazy);
  }

  await openProduct(page, product.name);
  await expect(
    page.getByRole("heading", { level: 1, name: product.name }),
  ).toBeVisible();
  expect(loaded.filter((name) => name === "ProductDetailPage")).toHaveLength(1);
  expectNoProblems(problems);

  const nav = page.getByRole("navigation", { name: "Utama" });
  await nav.getByRole("link", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Masuk" }),
  ).toBeVisible();
  expect(loaded).toContain("LoginPage");
  expect(loaded).not.toContain("RegisterPage");
  const afterLogin = loaded.length;

  await nav.getByRole("link", { name: "Daftar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Daftar akun" }),
  ).toBeVisible();
  // Only the register page's own chunk: the form code both pages share
  // (React Hook Form, Zod) came with the login page.
  expect(loaded.slice(afterLogin)).toEqual(["RegisterPage"]);

  // Back to a page whose chunk is loaded: nothing is fetched again.
  const beforeBack = loaded.length;
  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Masuk" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: product.name }),
  ).toBeVisible();
  expect(loaded).toHaveLength(beforeBack);
  expectNoProblems(problems);
});
