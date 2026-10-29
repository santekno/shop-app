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

/** One size of a product photo (the contract's ImageVariant). */
export interface ImageVariantRow {
  width: number;
  height: number;
  url: string;
}

/** One product photo (the contract's ProductImage). */
export interface ImageRow {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  /** Narrowest first. */
  variants: ImageVariantRow[];
}

/**
 * One product of GET /v1/products and GET /v1/products/{slug}, as the
 * contract defines it.
 */
export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: { id: string; slug: string; name: string };
  price_from: { amount: number; currency: string };
  in_stock: boolean;
  variants: VariantRow[];
  /** Ready photos only, in order; the storefront ignores them until Bab 11. */
  images: ImageRow[];
  /** RFC 3339. */
  created_at: string;
  /** RFC 3339: the last time an admin saved the product (the sitemap's lastmod). */
  updated_at: string;
}

/** The storefront's page size (CatalogPage's PAGE_SIZE). */
export const PAGE_SIZE = 12;

/**
 * The query of the catalog's first page with no filter in the URL: the
 * default sort is sent explicitly, then the page size.
 */
export const FIRST_PAGE_QUERY = `sort=newest&limit=${PAGE_SIZE}`;

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

/**
 * Every page of GET /v1/products?limit=12, in order, following
 * next_cursor; filters (category, q, sort) are added to every request.
 */
export const fetchAllProducts = async (
  filters: Readonly<Record<string, string>> = {},
): Promise<ProductRow[][]> => {
  const pages: ProductRow[][] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${API_URL}/v1/products`);
    for (const [name, value] of Object.entries(filters)) {
      url.searchParams.set(name, value);
    }
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

/** What opens a product from its card: the name, as a link or a button. */
export const cardOpener = (page: Page, name: string): Locator =>
  productSection(page)
    .locator(".product-card__name")
    .getByRole("link", { name, exact: true })
    .or(
      productSection(page)
        .locator(".product-card__name")
        .getByRole("button", { name, exact: true }),
    );

/**
 * Loads every page until "Semua produk sudah ditampilkan." shows. The list
 * may load the next page by itself when its sentinel scrolls into view, so
 * the "Muat lebih banyak" button can disappear just before a click; each
 * round therefore clicks it when it is there, or scrolls the last card into
 * view, and then only waits for more cards or the end.
 */
export const loadEverything = async (page: Page): Promise<void> => {
  const section = productSection(page);
  const more = section.getByRole("button", { name: "Muat lebih banyak" });
  const done = section.getByText("Semua produk sudah ditampilkan.");
  await expect(productCards(page).first()).toBeVisible();
  while (!(await done.isVisible())) {
    const before = await productCards(page).count();
    if (await more.isVisible()) {
      // The button is disabled while the list refetches in the background;
      // click() waits for it to be enabled. It may also vanish because the
      // sentinel loaded the page first, which the poll below accepts.
      await more.click({ timeout: 5000 }).catch(() => undefined);
    } else {
      await productCards(page).last().scrollIntoViewIfNeeded();
    }
    await expect
      .poll(
        async () =>
          (await done.isVisible()) ||
          (await productCards(page).count()) > before,
      )
      .toBe(true);
  }
};

/**
 * Turns the catalog's automatic loading off for the page: without an
 * IntersectionObserver the sentinel does nothing, and "Muat lebih banyak"
 * is the only way to the next page (the fallback the storefront keeps for
 * browsers that lack the observer). Call it before page.goto.
 */
export const disableAutoLoad = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "IntersectionObserver");
  });
};

/**
 * Opens a product from the catalog by its card's name, loading more pages
 * first when the card is not on the ones already shown.
 */
export const openProduct = async (page: Page, name: string): Promise<void> => {
  const opener = cardOpener(page, name);
  await expect(productCards(page).first()).toBeVisible();
  if ((await opener.count()) === 0) await loadEverything(page);
  await opener.click();
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

/**
 * text as React writes it into server-rendered HTML (escapeTextForBrowser),
 * to look for an API value in a page's source.
 */
export const asHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

/** Fails on any console error, uncaught exception or CSP violation. */
export const expectNoProblems = (problems: BrowserProblems): void => {
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
};
