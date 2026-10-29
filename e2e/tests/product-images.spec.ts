// Product photos (Bab 11 artikel 12): a card and the product page draw
// the first ready photo with a plain <img> whose srcset lists the API's
// variants (400 and 800 px JPEGs the worker made) on the image storage's
// origin (IMAGE_ORIGIN), with the API's width and height, and the CSP's
// img-src allows that origin and no other.
//
// The seeded catalog has no photos, so the spec makes its own product
// through the admin API and uploads a photo the way the admin will: a
// presigned PUT straight to the storage, a confirm, and the worker's
// resize. The product is archived afterwards. It is only ever opened at
// URLs no other spec asks for (a search for its own word, its own page),
// so the storefront's data cache of the catalog, which later specs
// compare with the API, never holds it.
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { clearRateLimits } from "../support/accounts.ts";
import { watchBrowser } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchProduct,
  productCards,
} from "../support/catalog.ts";
import type { ImageRow, ProductRow } from "../support/catalog.ts";
import { apiLogin, authCall, registerAdmin } from "../support/orders.ts";
import { pngImage } from "../support/png.ts";
import { expectedProductJsonLd, headOf, jsonLdBlock } from "../support/seo.ts";
import { fetchCategories, stackImageOrigin } from "../support/stack.ts";

/** A word no other product has, so a search finds this product alone. */
const WORD = `ujifoto${crypto.randomUUID().slice(0, 6).replace(/-/g, "")}`;
const SLUG = `lampu-meja-${WORD}`;
const NAME = `Lampu Meja ${WORD}`;
const ALT = "Lampu meja rotan menyala di atas nakas";

let adminToken: string;
let productId: string | undefined;
let product: ProductRow;
let photo: ImageRow;

/** Waits for the worker to make the photo ready (normally within 30 s). */
const readyProduct = async (): Promise<ProductRow> => {
  let ready: ProductRow | undefined;
  await expect
    .poll(
      async () => {
        const row = await fetchProduct(SLUG);
        ready = row;
        return row.images[0]?.variants.length ?? 0;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(2);
  if (ready === undefined) throw new Error("no product");
  return ready;
};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  clearRateLimits();
  const admin = await registerAdmin("foto");
  adminToken = await apiLogin(admin);
  const category = (await fetchCategories()).find(
    (row) => row.slug === "dekorasi-rumah",
  );
  if (category === undefined) throw new Error("no dekorasi-rumah category");
  const created = await authCall<{ id: string }>(
    adminToken,
    "POST",
    "/v1/admin/products",
    201,
    {
      category_id: category.id,
      slug: SLUG,
      name: NAME,
      description: "Lampu meja anyaman rotan untuk uji foto produk.",
      status: "active",
      variants: [
        {
          sku: `E2E-${WORD.toUpperCase()}`,
          name: "Standar",
          price: 125_000,
          stock: 5,
          weight_grams: 800,
        },
      ],
    },
  );
  const id = created.id;
  productId = id;

  // The admin's upload: a presigned PUT straight to the storage, signed
  // for this type and size, then a confirm the API checks the file with.
  const file = pngImage(1200, 900);
  const started = await authCall<{
    image: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>(adminToken, "POST", `/v1/admin/products/${id}/images/uploads`, 201, {
    content_type: "image/png",
    size_bytes: file.length,
  });
  // fetch sets Content-Length from the body itself.
  const headers = Object.fromEntries(
    Object.entries(started.upload.headers).filter(
      ([name]) => name.toLowerCase() !== "content-length",
    ),
  );
  const put = await fetch(started.upload.url, {
    method: "PUT",
    headers,
    body: new Uint8Array(file),
  });
  expect(put.status, `PUT ${started.upload.url}`).toBe(200);
  await authCall(
    adminToken,
    "POST",
    `/v1/admin/products/${id}/images/${started.image.id}/confirm`,
    200,
    { alt: ALT },
  );
  product = await readyProduct();
  const [first] = product.images;
  if (first === undefined) throw new Error("no photo");
  photo = first;
});

test.afterAll(async () => {
  // Off the storefront again: the catalog is as make seed left it.
  if (productId !== undefined) {
    await authCall(
      adminToken,
      "DELETE",
      `/v1/admin/products/${productId}`,
      204,
    );
  }
});

/** The srcset the storefront must write: every variant, narrowest first. */
const expectedSrcset = (image: ImageRow): string =>
  [...image.variants]
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${variant.url} ${String(variant.width)}w`)
    .join(", ");

/** Every answer the page gets from the image origin, by URL. */
const imageAnswers = (page: Page, origin: string): Map<string, number> => {
  const answers = new Map<string, number>();
  page.on("response", (response) => {
    if (response.url().startsWith(`${origin}/`)) {
      answers.set(response.url(), response.status());
    }
  });
  return answers;
};

/** Checks the <img> against the API's photo, and that the browser drew it. */
const expectPhoto = async (
  img: Locator,
  answers: Map<string, number>,
  origin: string,
): Promise<void> => {
  await expect(img).toHaveAttribute("srcset", expectedSrcset(photo));
  await expect(img).toHaveAttribute("src", photo.url);
  await expect(img).toHaveAttribute("width", String(photo.width));
  await expect(img).toHaveAttribute("height", String(photo.height));
  await expect(img).toHaveAttribute("alt", ALT);
  await expect(img).toHaveAttribute("decoding", "async");
  await expect(img).toHaveAttribute("sizes", /.+/);
  for (const variant of photo.variants) {
    expect(variant.url.startsWith(`${origin}/`), variant.url).toBe(true);
  }
  // Loaded and decoded, from one of the variants, answered 200.
  await expect
    .poll(() =>
      img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth),
    )
    .toBeGreaterThan(0);
  const current = await img.evaluate((el: HTMLImageElement) => el.currentSrc);
  expect([photo.url, ...photo.variants.map((v) => v.url)]).toContain(current);
  expect(answers.get(current), current).toBe(200);
};

test("the API's photo is ready in two sizes on the image storage, served as long-lived JPEGs", async () => {
  const origin = stackImageOrigin();
  expect(photo.variants.map((v) => v.width)).toEqual([400, 800]);
  expect(photo.alt).toBe(ALT);
  for (const variant of photo.variants) {
    expect(variant.url.startsWith(`${origin}/`)).toBe(true);
    const response = await fetch(variant.url);
    expect(response.status, variant.url).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    // The worker writes each variant once under its own key (ADR 0007).
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  }
});

test("a catalog card draws the photo with the variants' srcset, its size and alt, and the CSP lets it load", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const origin = stackImageOrigin();
  const answers = imageAnswers(page, origin);
  const response = await page.goto(`/?q=${WORD}`);
  // img-src: this origin, and only it besides the page's own.
  expect(response?.headers()["content-security-policy"]).toContain(
    `img-src 'self' data: ${new URL(origin).origin};`,
  );
  await expect(productCards(page)).toHaveCount(1);
  const img = productCards(page).first().locator("img");
  await expectPhoto(img, answers, origin);
  // The first row of a grid is on screen at once: not lazy.
  await expect(img).toHaveAttribute("loading", "eager");
  await expect(productCards(page).first()).not.toContainText("Belum ada foto");
  expectNoProblems(problems);
});

test("the product page draws the photo first (eager, high priority), and its JSON-LD and Open Graph name it", async ({
  page,
  request,
}) => {
  const problems = await watchBrowser(page);
  const origin = stackImageOrigin();
  const answers = imageAnswers(page, origin);
  await page.goto(`/produk/${SLUG}`);
  const img = page.getByRole("article", { name: NAME }).locator("img");
  await expect(img).toHaveCount(1);
  await expectPhoto(img, answers, origin);
  await expect(img).toHaveAttribute("loading", "eager");
  await expect(img).toHaveAttribute("fetchpriority", "high");
  expectNoProblems(problems);

  const head = await headOf(request, `/produk/${SLUG}`);
  expect(jsonLdBlock(head.html, "Product")).toEqual(
    expectedProductJsonLd(product),
  );
  // A photo makes the link preview large.
  expect(head.meta["og:image"]).toBe(photo.url);
  expect(head.meta["twitter:card"]).toBe("summary_large_image");
});
