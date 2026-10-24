// The product catalog as the API serves it, read with plain fetch (not
// @goshop/shared), so the storefront is checked against the contract and
// not against its own client code.
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { BrowserProblems } from "./browser.ts";
import { API_URL } from "./stack.ts";

/** One variant of GET /v1/products, as the contract defines it. */
export interface VariantRow {
  id: string;
  sku: string;
  name: string;
  price: { amount: number; currency: string };
  stock: number;
}

/** One product of GET /v1/products and GET /v1/products/{slug}. */
export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: { id: string; slug: string; name: string };
  price_from: { amount: number; currency: string };
  in_stock: boolean;
  variants: VariantRow[];
}

/** The storefront's page size (CatalogPage's PAGE_SIZE). */
export const PAGE_SIZE = 12;

/**
 * Every product slug make seed writes (apps/api/cmd/seed/catalog.go). The
 * Compose database may hold more, so specs check that these are there, and
 * compare everything else with what the API returns.
 */
export const SEEDED_SLUGS: readonly string[] = [
  "kaos-polos-hitam",
  "kaos-polos-putih",
  "kaos-grafis-batik-mega-mendung",
  "kaos-oversize-abu-abu",
  "kemeja-batik-parang",
  "kemeja-flanel-kotak-merah",
  "kemeja-linen-putih",
  "celana-chino-krem",
  "celana-jeans-slim-fit-biru",
  "celana-pendek-kargo-hijau-army",
  "ponsel-android-128gb",
  "ponsel-android-256gb",
  "casing-silikon-bening",
  "kabel-data-usb-c",
  "pengisi-daya-cepat-20w",
  "power-bank-10000mah",
  "wajan-anti-lengket",
  "set-pisau-dapur-stainless",
  "rice-cooker-1-8-liter",
  "lampu-tidur-rotan",
  "tanaman-hias-artifisial-monstera",
  "bingkai-foto-kayu-jati",
  "kopi-arabika-gayo-250g",
  "kopi-robusta-lampung-500g",
  "teh-hijau-melati-50-kantong",
  "keripik-singkong-balado-200g",
  "kacang-mete-panggang-250g",
  "rengginang-terasi-250g",
];

/** Every page of GET /v1/products?limit=12, in order, following next_cursor. */
export const fetchAllProducts = async (): Promise<ProductRow[][]> => {
  const pages: ProductRow[][] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${API_URL}/v1/products`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await fetch(url);
    expect(response.status, `GET ${url.pathname}${url.search}`).toBe(200);
    const body = (await response.json()) as {
      data: ProductRow[];
      page: { next_cursor: string | null };
    };
    pages.push(body.data);
    cursor = body.page.next_cursor;
  } while (cursor !== null);
  return pages;
};

/** GET /v1/products/{slug} with plain fetch. */
export const fetchProduct = async (slug: string): Promise<ProductRow> => {
  const response = await fetch(
    `${API_URL}/v1/products/${encodeURIComponent(slug)}`,
  );
  expect(response.status, `GET /v1/products/${slug}`).toBe(200);
  return ((await response.json()) as { data: ProductRow }).data;
};

/**
 * Whole rupiah the way Indonesian shops write them: "Rp", a no-break space,
 * and dots between thousands (89000 -> "Rp 89.000"). Written out by hand,
 * not with Intl, so the storefront's formatRupiah is checked, not repeated.
 */
export const rupiah = (amount: number): string =>
  `Rp\u00a0${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** The catalog's product section. */
export const productSection = (page: Page): Locator =>
  page.getByRole("region", { name: "Produk" });

/** The cards in the catalog grid, in order. */
export const productCards = (page: Page): Locator =>
  productSection(page).locator(".product-grid > li > article");

/** Clicks "Muat lebih banyak" until the end message shows. */
export const loadEverything = async (page: Page): Promise<void> => {
  const section = productSection(page);
  const more = section.getByRole("button", { name: "Muat lebih banyak" });
  const done = section.getByText("Semua produk sudah ditampilkan.");
  await expect(more.or(done)).toBeVisible();
  while (await more.isVisible()) {
    const before = await productCards(page).count();
    await more.click();
    await expect(productCards(page)).not.toHaveCount(before);
    await expect(more.or(done)).toBeVisible();
  }
};

/**
 * Opens a product from the catalog by its card's name, loading more pages
 * first when the card is not on the ones already shown.
 */
export const openProduct = async (page: Page, name: string): Promise<void> => {
  const button = productSection(page).getByRole("button", {
    name,
    exact: true,
  });
  await expect(productCards(page).first()).toBeVisible();
  if ((await button.count()) === 0) await loadEverything(page);
  await button.click();
};

/** Counts the requests the page sends, per API path (query left out). */
export const countApiRequests = (
  page: Page,
  apiUrl: string,
): Map<string, string[]> => {
  const calls = new Map<string, string[]>();
  page.on("request", (request) => {
    if (!request.url().startsWith(`${apiUrl}/`)) return;
    const url = new URL(request.url());
    const list = calls.get(url.pathname) ?? [];
    list.push(`${request.method()} ${url.pathname}${url.search}`);
    calls.set(url.pathname, list);
  });
  return calls;
};

/** Fails on any console error, uncaught exception or CSP violation. */
export const expectNoProblems = (problems: BrowserProblems): void => {
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
};
