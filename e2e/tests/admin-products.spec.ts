// The dashboard's products (Bab 12 artikel 02–05) against the real stack:
// the product table driven by its URL (search, sort, pages), a product
// made through the three-step form, a real photo uploaded from the browser
// straight to the storage (SeaweedFS) with its progress shown, made ready
// by the worker, and a quick stock change.
//
// Every product made here is a draft, so the storefront, whose catalog
// other specs compare with the API, never lists it; each carries a word of
// its own, so a search finds this run's products only.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { clearRateLimits } from "../support/accounts.ts";
import { ADMIN, adminLogIn, adminUrl } from "../support/admin.ts";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems } from "../support/catalog.ts";
import { apiLogin, authCall } from "../support/orders.ts";
import { noisePngImage } from "../support/png.ts";
import { fetchCategories } from "../support/stack.ts";

/** A word no other product has. */
const WORD = `ujitabel${crypto.randomUUID().slice(0, 8).replace(/-/g, "")}`;

/** The parts of AdminProduct the specs read. */
interface AdminProductRow {
  id: string;
  name: string;
  status: string;
  version: number;
  variants: { id: string; sku: string; name: string; stock: number }[];
  images: {
    id: string;
    status: string;
    variants: { width: number; url: string }[];
  }[];
}

/** The twelve table products: name, cheapest price, stock. */
const TABLE = Array.from({ length: 12 }, (_, i) => ({
  name: `${WORD} Produk ${String.fromCharCode(65 + i)}`,
  // Not in name order, so sorting by price is a different order.
  price: 10_000 + ((i * 7) % 12) * 1_000,
  stock: i < 3 ? i + 1 : 20 + i,
}));

let token: string;
let kaosId: string;
const made: string[] = [];

/** POST /v1/admin/products: a draft with one variant. */
const createDraft = async (
  name: string,
  price: number,
  stock: number,
): Promise<AdminProductRow> => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const product = await authCall<AdminProductRow>(
    token,
    "POST",
    "/v1/admin/products",
    201,
    {
      category_id: kaosId,
      slug,
      name,
      description: `Produk uji ${name}`,
      status: "draft",
      variants: [
        {
          sku: `${slug}-m`.toUpperCase().slice(-60),
          name: "M",
          price,
          stock,
          weight_grams: 250,
        },
      ],
    },
  );
  made.push(product.id);
  return product;
};

/** The product table's rows, by the product names they link. */
const tableNames = (page: Page) =>
  page
    .getByRole("region", { name: /^Daftar produk/ })
    .getByRole("link")
    .allTextContents();

/** The search part of the table's URL now. */
const urlParams = (page: Page): URLSearchParams =>
  new URL(page.url()).searchParams;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  clearRateLimits();
  token = await apiLogin(ADMIN);
  kaosId = (await fetchCategories()).find((c) => c.slug === "kaos")?.id ?? "";
  for (const row of TABLE) await createDraft(row.name, row.price, row.stock);
});

test.afterAll(async () => {
  for (const id of made) {
    await authCall(token, "DELETE", `/v1/admin/products/${id}`, 204);
  }
});

test("the product table follows its URL: search, sort and pages", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const byName = TABLE.map((row) => row.name).sort();
  const byPriceDesc = [...TABLE]
    .sort((a, b) => b.price - a.price)
    .map((row) => row.name);

  await adminLogIn(
    page,
    ADMIN,
    `/produk?q=${WORD}&urut=nama&arah=naik&per_halaman=10`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Produk");
  await expect(page.getByLabel("Cari produk")).toHaveValue(WORD);
  await expect.poll(() => tableNames(page)).toEqual(byName.slice(0, 10));
  await expect(
    page.getByText("Menampilkan 1–10 dari 12 produk", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Halaman 1 dari 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Produk" }),
  ).toHaveAttribute("aria-sort", "ascending");

  // Page 2, by the button: the URL says so.
  const pages = page.getByRole("navigation", { name: "Halaman tabel produk" });
  await pages.getByRole("button", { name: "Halaman berikutnya" }).click();
  await expect.poll(() => urlParams(page).get("halaman")).toBe("2");
  await expect.poll(() => tableNames(page)).toEqual(byName.slice(10));
  await expect(
    page.getByText("Menampilkan 11–12 dari 12 produk", { exact: true }),
  ).toBeVisible();

  // Sorting by price starts at the most expensive and goes back to page 1.
  await page
    .getByRole("columnheader", { name: "Harga mulai" })
    .getByRole("button")
    .click();
  await expect.poll(() => urlParams(page).get("urut")).toBe("harga");
  expect(urlParams(page).get("halaman")).toBeNull();
  await expect.poll(() => tableNames(page)).toEqual(byPriceDesc.slice(0, 10));
  await expect(
    page.getByRole("columnheader", { name: "Harga mulai" }),
  ).toHaveAttribute("aria-sort", "descending");

  // The address is the table: opened afresh, it shows the same rows, and
  // Back returns to the page before.
  const url = page.url();
  await page.goto(url);
  await expect.poll(() => tableNames(page)).toEqual(byPriceDesc.slice(0, 10));
  await page.goBack();
  await expect.poll(() => urlParams(page).get("halaman")).toBe("2");

  // Low stock: the three products with 1, 2 and 3 units.
  await page.goto(
    adminUrl(`/produk?q=${WORD}&stok=menipis&urut=nama&arah=naik`),
  );
  await expect
    .poll(() => tableNames(page))
    .toEqual(
      byName.filter(
        (name) => (TABLE.find((r) => r.name === name)?.stock ?? 99) <= 5,
      ),
    );

  // Typing a search narrows the table and writes q into the URL.
  await page.goto(adminUrl("/produk?per_halaman=10"));
  await page.getByLabel("Cari produk").fill(`${WORD} Produk C`);
  await expect.poll(() => urlParams(page).get("q")).toBe(`${WORD} Produk C`);
  await expect.poll(() => tableNames(page)).toEqual([`${WORD} Produk C`]);
  expectNoProblems(problems);
});

test("a product made with the form gets a photo uploaded to the storage and made ready by the worker", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = await watchBrowser(page);
  const name = `${WORD} Kaos Foto`;
  const sku = `${WORD}-FOTO`.toUpperCase();
  await adminLogIn(page, ADMIN, "/produk/baru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tambah produk",
  );

  // Step 1: the basics. The slug follows the name.
  await page.getByLabel("Nama produk").fill(name);
  await expect(page.getByLabel("Slug")).toHaveValue(
    name.toLowerCase().replace(/ /g, "-"),
  );
  await page.getByLabel("Kategori", { exact: true }).selectOption(kaosId);
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByLabel("Deskripsi").fill("Kaos katun untuk uji unggah foto.");
  await page.getByRole("button", { name: "Lanjut" }).click();

  // Step 2: one variant.
  await expect(
    page.getByRole("heading", { level: 2, name: "Varian & harga" }),
  ).toBeVisible();
  await page.getByLabel("SKU").fill(sku.toLowerCase());
  await page.getByLabel("Nama varian").fill("L");
  await page.getByLabel("Harga (Rp)").fill("89.000");
  await page.getByLabel("Stok", { exact: true }).fill("7");
  await page.getByLabel("Berat (gram)").fill("250");
  await page.getByRole("button", { name: "Lanjut" }).click();

  // Step 3: review, then create.
  await expect(
    page.getByRole("heading", { level: 2, name: "Tinjau" }),
  ).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByRole("button", { name: "Buat produk" }).click();
  await expect(page).toHaveURL(/\/produk\/[0-9a-f-]{36}$/);
  const productId = /\/produk\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? "";
  made.push(productId);
  await expect(
    page.getByText(
      `Produk “${name}” tersimpan. Tambahkan fotonya di halaman ini.`,
    ),
  ).toBeVisible();
  const saved = await authCall<AdminProductRow>(
    token,
    "GET",
    `/v1/admin/products/${productId}`,
    200,
  );
  expect(saved.status).toBe("draft");
  expect(saved.variants).toEqual([
    expect.objectContaining({ sku, name: "L", stock: 7 }),
  ]);

  // The photo: about 1.4 MB that does not compress, sent straight to the
  // storage's presigned URL over a slowed-down connection, so the tile's
  // progress has steps between 0 and 100.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { progressSeen: number[] }).progressSeen = seen;
    const record = () => {
      for (const bar of document.querySelectorAll("progress")) {
        seen.push(Number(bar.getAttribute("value")));
      }
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["value"],
    });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: 256 * 1024,
  });
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") uploads.push(request.url());
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "foto-produk.png",
    mimeType: "image/png",
    buffer: noisePngImage(800, 600),
  });
  const photos = page.getByRole("list", { name: "Foto produk" });
  await expect(photos.getByText(/^Mengunggah \d+%$/)).toBeVisible();
  await expect(photos.getByText("Diproses untuk toko…")).toBeVisible({
    timeout: 60_000,
  });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const seen = await page.evaluate(
    () => (window as unknown as { progressSeen: number[] }).progressSeen,
  );
  expect(
    seen.filter((value) => value > 0 && value < 100).length,
    `progress values seen: ${seen.join(", ")}`,
  ).toBeGreaterThan(1);
  // The file went to the storage, never through the API.
  expect(uploads).toHaveLength(1);
  expect(new URL(uploads[0] ?? "").pathname).toContain(
    `/uploads/${productId}/`,
  );

  // The worker resizes it; the page asks again until it is ready.
  await expect(photos.getByText("Siap, tampil di toko")).toBeVisible({
    timeout: 120_000,
  });
  const withPhoto = await authCall<AdminProductRow>(
    token,
    "GET",
    `/v1/admin/products/${productId}`,
    200,
  );
  expect(withPhoto.images).toHaveLength(1);
  expect(withPhoto.images[0]?.status).toBe("ready");
  const variants = withPhoto.images[0]?.variants ?? [];
  expect(variants.map((v) => v.width)).toEqual([400, 800]);
  for (const variant of variants) {
    const image = await fetch(variant.url);
    expect(image.status, variant.url).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    await image.body?.cancel();
  }
  // The table shows the photo as the product's thumbnail.
  await page.goto(adminUrl(`/produk?q=${encodeURIComponent(name)}`));
  await expect.poll(() => tableNames(page)).toEqual([name]);
  await expect(
    page
      .getByRole("region", { name: /^Daftar produk/ })
      .locator(`img[src="${variants[0]?.url ?? ""}"]`),
  ).toHaveCount(1);
  expectNoProblems(problems);
});

test("a quick stock change saves one variant's stock without the form", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await createDraft(`${WORD} Stok Cepat`, 45_000, 7);
  const variant = product.variants[0];
  if (variant === undefined) throw new Error("no variant");
  await adminLogIn(page, ADMIN, `/produk/${product.id}`);
  const panel = page.getByRole("region", { name: "Stok" });
  await expect(panel).toContainText("Total 7 unit di 1 varian");

  // Twenty received: added to the stock as it is when saved.
  await panel.getByRole("button", { name: "Ubah stok M" }).click();
  const editor = panel.getByRole("group", { name: "Ubah stok M" });
  await editor.getByLabel("Jumlah perubahan").fill("+20");
  await expect(editor).toContainText("Stok sekarang 7, menjadi 27.");
  await editor.getByRole("button", { name: "Simpan stok" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "Stok M: 7 → 27. Tersimpan.",
  );
  await expect(editor).toBeHidden();

  // A count.
  await panel.getByRole("button", { name: "Ubah stok M" }).click();
  await editor.getByRole("radio", { name: "Setel jumlah" }).check();
  await editor.getByLabel("Stok baru").fill("12");
  await editor.getByRole("button", { name: "Simpan stok" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "Stok M: 27 → 12. Tersimpan.",
  );

  const after = await authCall<AdminProductRow>(
    token,
    "GET",
    `/v1/admin/products/${product.id}`,
    200,
  );
  expect(after.variants[0]?.stock).toBe(12);
  // Stock is not the product's own field: its version did not move.
  expect(after.version).toBe(product.version);
  expectNoProblems(problems);
});
