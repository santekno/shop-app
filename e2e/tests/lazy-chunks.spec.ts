// Code splitting in the built image: the catalog loads without the product
// and auth pages' code, and each of those arrives as JavaScript of its own
// the first time its page is opened, never twice. Bab 9–10 had React
// Router's lazy routes, with named chunks; since Bab 11 Next.js splits per
// page by itself and its file names are hashes only (turbopack), so a
// page's code is recognised as the files that page loads and the pages
// before it did not.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchProduct,
  openProduct,
  productCards,
} from "../support/catalog.ts";

/** The JS files the page loads from /_next/static/, in order. */
const scripts = (page: Page): string[] => {
  const files: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/_next/static/") && pathname.endsWith(".js")) {
      files.push(pathname);
    }
  });
  return files;
};

/** The files loaded since index from, which must all be new. */
const newSince = (loaded: string[], from: number): string[] => {
  const added = loaded.slice(from);
  for (const file of added) {
    expect(loaded.slice(0, from), `${file} loaded twice`).not.toContain(file);
  }
  return added;
};

test("the product and auth pages each load code of their own, once, when first opened", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const loaded = scripts(page);
  const product = await fetchProduct("kopi-arabika-gayo-250g");

  await page.goto("/");
  await expect(productCards(page).first()).toBeVisible();
  const catalog = loaded.length;
  expect(catalog, "the catalog's own files").toBeGreaterThan(0);
  // Next.js prefetches the links in view, but a prefetch fetches the
  // page's server payload, not its code.
  await page.waitForLoadState("networkidle");
  expect(loaded).toHaveLength(catalog);

  await openProduct(page, product.name);
  await expect(
    page.getByRole("heading", { level: 1, name: product.name }),
  ).toBeVisible();
  const productCode = newSince(loaded, catalog);
  expect(productCode.length, "the product page's code").toBeGreaterThan(0);
  expectNoProblems(problems);

  const nav = page.getByRole("navigation", { name: "Utama" });
  const beforeLogin = loaded.length;
  await nav.getByRole("link", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Masuk" }),
  ).toBeVisible();
  const loginCode = newSince(loaded, beforeLogin);
  expect(loginCode.length, "the login page's code").toBeGreaterThan(0);

  const beforeRegister = loaded.length;
  await nav.getByRole("link", { name: "Daftar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Daftar akun" }),
  ).toBeVisible();
  // Only the register page's own code: what both forms share (React Hook
  // Form, Zod) came with the login page.
  const registerCode = newSince(loaded, beforeRegister);
  expect(registerCode.length, "the register page's code").toBeGreaterThan(0);
  expect(registerCode.length).toBeLessThan(loginCode.length);

  // Back to pages whose code is loaded: nothing is fetched again.
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
