// React's development warnings, such as a list item without a unique
// `key`, exist only in a development build: the production bundle the web
// container serves strips them. So this spec starts the Vite dev server,
// walks the same flows as the other specs (catalog, every page, a product,
// its choices, back), and fails on any console error or warning.
//
// The dev server has an origin of its own, which the API's CORS does not
// allow, so each API call is passed through Playwright to the real API and
// handed back with Access-Control-Allow-Origin added. The data is real.
// The web session endpoints (Bab 10) also refuse an Origin they do not
// know, so the call is forwarded with the stack's own storefront origin,
// and their answer allows credentials, as the API's does for that origin.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  loadEverything,
  openProduct,
  productCards,
  productSection,
} from "../support/catalog.ts";
import {
  BROWSER_API_URL,
  REPO_ROOT,
  WEB_URL,
  waitForOk,
} from "../support/stack.ts";

/** A port nothing listens on right now. */
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
};

test("the development build logs no warning or error across the storefront", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const webDir = path.join(REPO_ROOT, "apps", "web");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let vite: ChildProcess | undefined;
  let output = "";

  try {
    vite = spawn(
      path.join(webDir, "node_modules", ".bin", "vite"),
      ["--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      {
        cwd: webDir,
        env: {
          ...process.env,
          VITE_API_URL: BROWSER_API_URL,
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    vite.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    vite.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await waitForOk(`${origin}/`, 60_000);

    await page.route(`${BROWSER_API_URL}/**`, async (route) => {
      const request = route.request();
      const response = await route.fetch({
        headers: { ...(await request.allHeaders()), origin: WEB_URL },
      });
      const session = new URL(request.url()).pathname.startsWith(
        "/v1/auth/web/",
      );
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": origin,
          // What the API's CORS lets a browser read on its own origins.
          "access-control-expose-headers": "X-Request-ID, X-Cart-Token",
          ...(session ? { "access-control-allow-credentials": "true" } : {}),
        },
      });
    });

    // The first visit makes Vite pre-bundle the dependencies, which may
    // reload the page once; only the second visit is checked.
    await page.goto(origin);
    await expect(productCards(page).first()).toBeVisible({ timeout: 60_000 });

    const messages: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        messages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) =>
      messages.push(`pageerror: ${String(error)}`),
    );

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Kategori" }).getByRole("list").first(),
    ).toBeVisible();
    // Every page of products, so every list render (and every append) ran.
    await loadEverything(page);

    // A product with several variants: pick one, step the quantity, back.
    await openProduct(page, "Kaos Oversize Abu-abu");
    const article = page.getByRole("article", {
      name: "Kaos Oversize Abu-abu",
    });
    await article.getByRole("radio", { name: /^L/ }).check();
    await article.getByRole("button", { name: "Tambah jumlah" }).click();
    await page.getByRole("link", { name: "← Kembali ke katalog" }).click();
    await expect(productSection(page)).toBeVisible();

    // A sold-out variant and the brand link.
    await openProduct(page, "Rengginang Terasi 250 g");
    await page
      .getByRole("article", { name: "Rengginang Terasi 250 g" })
      .getByRole("radio", { name: /^250 g/ })
      .check();
    await page
      .getByRole("banner")
      .getByRole("link", { name: "GoShop", exact: true })
      .click();
    await expect(productSection(page)).toBeVisible();

    // Bab 9's flows: a category, the sort, a search.
    await page
      .getByRole("region", { name: "Kategori" })
      .getByRole("link", { name: "Makanan & Minuman", exact: true })
      .click();
    await expect(page).toHaveURL(/kategori=makanan-minuman/);
    await productSection(page)
      .getByLabel("Urutkan")
      .selectOption({ label: "Harga tertinggi" });
    const search = productSection(page).getByRole("searchbox");
    await search.fill("kopi");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=kopi/);

    // Into the cart, and the cart page.
    await openProduct(page, "Kopi Arabika Gayo 250 g");
    const kopi = page.getByRole("article", { name: "Kopi Arabika Gayo 250 g" });
    await kopi.getByRole("button", { name: "Tambah ke keranjang" }).click();
    await kopi.getByRole("link", { name: "Lihat keranjang" }).click();
    await expect(page.locator(".cart-line")).toHaveCount(1);

    // The forms, with their client-side errors.
    const nav = page.getByRole("navigation", { name: "Utama" });
    await nav.getByRole("link", { name: "Masuk" }).click();
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page.getByText("Masukkan email Anda.")).toBeVisible();
    await nav.getByRole("link", { name: "Daftar" }).click();
    await page.getByRole("button", { name: "Daftar" }).click();
    await expect(page.getByText("Masukkan nama Anda.")).toBeVisible();

    // An unknown address and a product that does not exist: both end on
    // the 404 page, in the app (pushState), not through a reload.
    for (const path of ["/tidak-ada", "/produk/produk-yang-tidak-ada"]) {
      await page.evaluate((url) => {
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, path);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Halaman tidak ditemukan",
        }),
      ).toBeVisible();
    }

    // React 19 reports a missing or duplicate key with console.error in
    // development ("Each child in a list should have a unique key prop").
    // The one line allowed is Chrome's own for the missing product's 404,
    // the answer under test; the expected NOT_FOUND is not logged.
    expect(messages).toEqual([
      "error: Failed to load resource: the server responded with a status of 404 (Not Found)",
    ]);
  } catch (error) {
    throw new Error(`${String(error)}\n--- vite output ---\n${output}`, {
      cause: error,
    });
  } finally {
    // A request still in flight when the test ends (a background refetch)
    // must not fail the next test from its route handler.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    vite?.kill("SIGTERM");
  }
});
