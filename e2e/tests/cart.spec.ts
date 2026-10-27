// The guest cart against the real API: adding raises the header's count at
// the click (before the API answers), the first add creates the cart and
// its X-Cart-Token, a 409 puts the count back and says why, /keranjang
// lists what the API holds, and since Bab 10 (artikel 10) a reload keeps
// the token, which the cart store saves in localStorage.
import { expect, test } from "@playwright/test";
import type { Page, Request, Route } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import type { BrowserProblems } from "../support/browser.ts";
import {
  expectNoProblems,
  fetchProduct,
  openProduct,
  rupiah,
} from "../support/catalog.ts";
import type { ProductRow } from "../support/catalog.ts";
import { API_URL, BROWSER_API_URL } from "../support/stack.ts";

const ITEMS_URL = `${BROWSER_API_URL}/v1/cart/items`;

/** The header's cart link, named with its count ("Keranjang 2 barang"). */
const cartLink = (page: Page) =>
  page.getByRole("navigation", { name: "Utama" }).getByRole("link", {
    name: /^Keranjang/,
  });

const expectCount = async (page: Page, count: number): Promise<void> => {
  await expect(cartLink(page)).toHaveAccessibleName(
    count === 0 ? "Keranjang" : `Keranjang ${count} barang`,
  );
};

/**
 * Holds every POST /v1/cart/items until release() is called, so the test
 * can look at the page while the request is in flight.
 */
const holdAdds = async (page: Page) => {
  let release: () => void = () => undefined;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ITEMS_URL, async (route: Route) => {
    await gate;
    await route.continue();
  });
  return {
    release: () => {
      release();
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  };
};

/** The POST /v1/cart/items requests the page sends. */
const addRequests = (page: Page): Request[] => {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (request.url() === ITEMS_URL && request.method() === "POST") {
      requests.push(request);
    }
  });
  return requests;
};

/** The X-Cart-Token of every GET /v1/cart the page sends. */
const cartGets = (page: Page): (string | undefined)[] => {
  const tokens: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url() === `${BROWSER_API_URL}/v1/cart`
    ) {
      tokens.push(request.headers()["x-cart-token"]);
    }
  });
  return tokens;
};

const productControls = (page: Page, product: ProductRow) => {
  const article = page.getByRole("article", { name: product.name });
  return {
    article,
    plus: article.getByRole("button", { name: "Tambah jumlah" }),
    add: article.getByRole("button", { name: "Tambah ke keranjang" }),
    adding: article.getByRole("button", { name: "Menambahkan…" }),
    // The add button's live region (the stepper's <output> is one too).
    status: article.locator(".add-to-cart").getByRole("status"),
    alert: article.getByRole("alert"),
    variant: (name: string) =>
      article.getByRole("radio", { name: new RegExp(`^${name}\\b`) }),
  };
};

/** Fails on anything but the expected 409 answers the test causes. */
const expectOnly409s = (problems: BrowserProblems, count: number): void => {
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 409",
      ),
  );
  expect(problems.consoleErrors.length - unexpected.length).toBe(count);
  expectNoProblems({ ...problems, consoleErrors: unexpected });
};

test("adding raises the count at the click, creates the cart token, and /keranjang lists it", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const requests = addRequests(page);
  const gets = cartGets(page);
  const product = await fetchProduct("kaos-oversize-abu-abu");
  const m = product.variants.find((v) => v.name === "M");
  const l = product.variants.find((v) => v.name === "L");
  expect(m && l).toBeTruthy();
  const adds = await holdAdds(page);

  await page.goto("/");
  await expectCount(page, 0);
  await openProduct(page, product.name);
  const c = productControls(page, product);
  await c.plus.click();

  // While the API has not answered, the count already shows the 2.
  await c.add.click();
  await expectCount(page, 2);
  await expect(c.adding).toBeDisabled();
  expect(requests).toHaveLength(1);
  adds.release();
  await expect(c.status).toContainText("Ditambahkan ke keranjang.");
  await expectCount(page, 2);

  // The first add created the cart: no token went out, one came back, in
  // the body and in the X-Cart-Token header.
  const first = requests[0];
  expect(first?.headers()["x-cart-token"]).toBeUndefined();
  expect(first?.postDataJSON()).toEqual({ variant_id: m?.id, quantity: 2 });
  const response = await first?.response();
  const token = response?.headers()["x-cart-token"] ?? "";
  expect(token).not.toBe("");
  expect(((await response?.json()) as { cart_token: string }).cart_token).toBe(
    token,
  );
  // Once the add has settled, the cart is fetched once in the background,
  // with the new token.
  await expect.poll(() => gets).toEqual([token]);

  // The second add (L keeps the quantity of 2) sends that token: the same
  // cart grows, and the count is raised at the click again.
  adds.hold();
  await c.variant("L").check();
  await c.add.click();
  await expectCount(page, 4);
  adds.release();
  await expect(c.add).toBeEnabled();
  await expectCount(page, 4);
  expect(requests[1]?.headers()["x-cart-token"]).toBe(token);
  expect(requests[1]?.postDataJSON()).toEqual({
    variant_id: l?.id,
    quantity: 2,
  });
  await expect.poll(() => gets).toEqual([token, token]);

  // /keranjang shows what the API holds for that token.
  const apiCart = (await (
    await fetch(`${API_URL}/v1/cart`, { headers: { "X-Cart-Token": token } })
  ).json()) as {
    data: {
      lines: {
        variant_name: string;
        quantity: number;
        line_total: { amount: number };
      }[];
      item_count: number;
      subtotal: { amount: number };
    };
  };
  expect(apiCart.data.item_count).toBe(4);
  await c.status.getByRole("link", { name: "Lihat keranjang" }).click();
  await expect(page).toHaveURL("/keranjang");
  await expect(page).toHaveTitle("Keranjang — GoShop");
  const lines = page.locator(".cart-line");
  await expect(lines).toHaveCount(apiCart.data.lines.length);
  for (const [index, line] of apiCart.data.lines.entries()) {
    const variant = line.variant_name === "M" ? m : l;
    await expect(lines.nth(index)).toContainText(product.name);
    await expect(lines.nth(index)).toContainText(
      `${line.variant_name} · ${line.quantity} × ${rupiah(variant?.price.amount ?? 0)}`,
    );
    await expect(lines.nth(index).locator("strong")).toHaveText(
      rupiah(line.line_total.amount),
    );
  }
  await expect(page.locator(".cart-subtotal")).toHaveText(
    `Subtotal (4 barang): ${rupiah(apiCart.data.subtotal.amount)}`,
  );
  // The page came from the cache those refetches filled; any further
  // fetch carried the token too.
  expect(gets.every((sent) => sent === token)).toBe(true);
  expectNoProblems(problems);
});

test("a 409 for too little stock puts the count back and says how many are left", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kaos-oversize-abu-abu");
  const xl = product.variants.find((v) => v.name === "XL");
  expect(xl?.stock).toBe(2);
  const adds = await holdAdds(page);

  await page.goto("/");
  await openProduct(page, product.name);
  const c = productControls(page, product);
  await c.variant("XL").check();
  await c.plus.click();
  adds.release();
  await c.add.click();
  await expect(c.status).toContainText("Ditambahkan ke keranjang.");
  await expectCount(page, 2);

  // Two more would make 4 of a stock of 2: the guess shows, then goes.
  adds.hold();
  await c.add.click();
  await expectCount(page, 4);
  adds.release();
  await expect(c.alert).toHaveText(
    "Stok tidak cukup. Tersedia 2, termasuk yang sudah ada di keranjang Anda.",
  );
  await expectCount(page, 2);
  expectOnly409s(problems, 1);
});

test("a 409 for the 99 limit puts the count back and names the limit", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("casing-silikon-bening");
  expect(product.variants[0]?.stock).toBeGreaterThan(99);

  await page.goto("/");
  await openProduct(page, product.name);
  const c = productControls(page, product);
  for (let n = 2; n <= 99; n++) await c.plus.click();
  await c.add.click();
  await expect(c.status).toContainText("Ditambahkan ke keranjang.");
  await expectCount(page, 99);

  // 99 more would make 198, over the 99 a line may hold (the stock of
  // 120 is not what stops it).
  await c.add.click();
  await expect(c.alert).toHaveText(
    "Satu barang paling banyak 99 buah per keranjang.",
  );
  await expectCount(page, 99);
  expectOnly409s(problems, 1);
});

test("a reload keeps the guest cart, from the token saved in localStorage", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const requests = addRequests(page);
  const product = await fetchProduct("kopi-arabika-gayo-250g");

  await page.goto("/");
  await openProduct(page, product.name);
  const c = productControls(page, product);
  await c.add.click();
  await expect(c.status).toContainText("Ditambahkan ke keranjang.");
  await expectCount(page, 1);
  const token =
    (await requests[0]?.response())?.headers()["x-cart-token"] ?? "";
  expect(token).not.toBe("");

  // The cart store saves only the token, under a versioned entry.
  const saved = await page.evaluate(() =>
    window.localStorage.getItem("goshop:cart"),
  );
  expect(JSON.parse(saved ?? "null")).toEqual({
    state: { token },
    version: 1,
  });

  // After a reload the header asks for the same cart at once.
  const gets = cartGets(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    product.name,
  );
  await expectCount(page, 1);
  await cartLink(page).click();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator(".cart-line")).toContainText(product.name);
  expect(gets.length).toBeGreaterThan(0);
  expect(gets.every((sent) => sent === token)).toBe(true);
  expectNoProblems(problems);
});

test("leaving and coming back during a slow first add still makes one cart", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const requests = addRequests(page);
  const product = await fetchProduct("kacang-mete-panggang-250g");
  // The order in which the adds go out and come back.
  const events: string[] = [];
  page.on("request", (request) => {
    if (request.url() === ITEMS_URL) events.push("POST sent");
  });
  page.on("response", (response) => {
    if (response.url() === ITEMS_URL) events.push("POST answered");
  });
  const adds = await holdAdds(page);

  await page.goto("/");
  await openProduct(page, product.name);
  await productControls(page, product).add.click();
  await expectCount(page, 1);

  // Away to the catalog and back to the product while the POST is held.
  await page.getByRole("link", { name: "← Kembali ke katalog" }).click();
  await openProduct(page, product.name);
  await productControls(page, product).add.click();
  await expectCount(page, 2);

  // The second add waits for the first, so it can send the token the
  // first one gets back: one cart, not two.
  adds.release();
  await expect
    .poll(() => events)
    .toEqual(["POST sent", "POST answered", "POST sent", "POST answered"]);
  const firstResponse = await requests[0]?.response();
  const token = firstResponse?.headers()["x-cart-token"] ?? "";
  expect(token).not.toBe("");
  expect(requests[1]?.headers()["x-cart-token"]).toBe(token);
  const second = await requests[1]?.response();
  expect(second?.headers()["x-cart-token"]).toBeUndefined();
  expect(
    ((await second?.json()) as { cart_token?: string }).cart_token,
  ).toBeUndefined();
  await expectCount(page, 2);

  const kept = (await (
    await fetch(`${API_URL}/v1/cart`, { headers: { "X-Cart-Token": token } })
  ).json()) as { data: { item_count: number } };
  expect(kept.data.item_count).toBe(2);
  expectNoProblems(problems);
});

test("a cart token the API does not know is forgotten, and /keranjang shows an empty cart and says why", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const gets = cartGets(page);
  const product = await fetchProduct("kopi-robusta-lampung-500g");
  let unknown = "";

  // The add is real, but the token it hands back is one the API never
  // issued: the same cart id with a different secret.
  await page.route(ITEMS_URL, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { cart_token?: string };
    // "<cart id>.<secret>": change the secret's first character (its last
    // one may carry only padding bits).
    const real = body.cart_token ?? "";
    const dot = real.indexOf(".");
    const swapped = real[dot + 1] === "A" ? "B" : "A";
    unknown = `${real.slice(0, dot + 1)}${swapped}${real.slice(dot + 2)}`;
    body.cart_token = unknown;
    await route.fulfill({
      response,
      json: body,
      headers: { ...response.headers(), "x-cart-token": unknown },
    });
  });

  await page.goto("/");
  await openProduct(page, product.name);
  const c = productControls(page, product);
  await c.add.click();
  await expect(c.status).toContainText("Ditambahkan ke keranjang.");

  // The background fetch with that token gets 404 CART_NOT_FOUND, and the
  // page forgets the token instead of showing an error.
  await expect.poll(() => gets).toEqual([unknown]);
  await expectCount(page, 0);
  await cartLink(page).click();
  await expect(page.getByText("Keranjang Anda masih kosong.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(gets).toEqual([unknown]);
  // Since Bab 10 the cart page says why the cart is empty, in a live
  // region, until the buyer closes the notice; the saved token is gone.
  const notice = page.getByRole("status").filter({
    hasText:
      "Keranjang Anda sebelumnya sudah tidak berlaku, jadi sekarang kosong.",
  });
  await expect(notice).toBeVisible();
  expect(
    await page.evaluate(() => window.localStorage.getItem("goshop:cart")),
  ).toBe(JSON.stringify({ state: { token: null }, version: 1 }));
  await page.getByRole("button", { name: "Tutup" }).click();
  await expect(notice).toHaveCount(0);

  // Chrome's line for that 404 is the only console error.
  const unexpected = problems.consoleErrors.filter(
    (text) =>
      !text.startsWith(
        "Failed to load resource: the server responded with a status of 404",
      ),
  );
  expect(problems.consoleErrors.length - unexpected.length).toBe(1);
  expectNoProblems({ ...problems, consoleErrors: unexpected });
});
