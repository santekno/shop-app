// React's development warnings, such as a list item without a unique
// `key`, exist only in a development build: the production bundle the web
// container serves strips them. So this spec starts the Vite dev server,
// walks the same flows as the other specs (catalog, every page, a product,
// its choices, back), and fails on any console error or warning.
//
// The dev server has an origin of its own, which the API's CORS does not
// allow, so each API call is passed through Playwright to the real API and
// handed back with Access-Control-Allow-Origin added. The data is real.
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
import { BROWSER_API_URL, REPO_ROOT, waitForOk } from "../support/stack.ts";

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
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": origin,
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

    // React 19 reports a missing or duplicate key with console.error in
    // development ("Each child in a list should have a unique key prop").
    expect(messages).toEqual([]);
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
