// Checkout to a paid order (Bab 11 artikel 04–05): a buyer adds a product,
// enters an address, picks a courier, presses "Buat pesanan & bayar", and
// pays; the payment page follows the order until the API says it is paid.
//
// The stack pays with its own test gateway (APP_PAYMENT_PROVIDER=fake):
// `api fake-pay` sends the API the signed notification Midtrans would.
// The API's Midtrans client has no configurable base URL, so it cannot be
// pointed at a fake Midtrans server; the Snap redirect journey therefore
// fakes Midtrans where the browser meets it: the pay answer is turned
// into a Snap redirect, and Midtrans' hosted page is a stub that sends
// the buyer back to the "Finish Redirect URL". The order itself is still
// placed, paid and decided by the real API.
import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { clearRateLimits } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems, rupiah } from "../support/catalog.ts";
import {
  ADDRESS,
  addToCart,
  apiLogin,
  authCall,
  createAddress,
  fakePay,
  getOrder,
  keepStock,
  productVariants,
  providerOrderId,
  registerVerifiedBuyer,
} from "../support/orders.ts";
import type { PaymentSessionRow } from "../support/orders.ts";
import { logIn } from "../support/session.ts";
import { BROWSER_API_URL, WEB_URL } from "../support/stack.ts";

/** A seeded product no other spec opens; its stock is put back afterwards. */
const SLUG = "bingkai-foto-kayu-jati";
const NAME = "Bingkai Foto Kayu Jati";

/** Midtrans' sandbox Snap host, which usePayOrder lets the buyer go to. */
const SNAP_ORIGIN = "https://app.sandbox.midtrans.com";

/** The payment page's URL, capturing the order id. */
const PAYMENT_URL = /\/pesanan\/([0-9a-f-]{36})\/pembayaran$/;

/** The sentence of the payment page's live region. */
const paymentStatus = (page: Page) => page.locator("p.payment-status");

/**
 * Polling waits 2, 2, 3, 5, 8… seconds between checks (payment-polling.ts),
 * so a payment made a few seconds after the page opened is seen within
 * one 8-second step or two.
 */
const PAID_WITHIN = { timeout: 20_000 };

let buyer: Account;
let token: string;
let restoreStock: () => void;

test.beforeAll(async () => {
  // Registers and logins of the whole suite come from one address; the
  // counters are local state, cleared the way global-setup clears them.
  clearRateLimits();
  buyer = await registerVerifiedBuyer("checkout");
  token = await apiLogin(buyer);
  restoreStock = await keepStock(SLUG);
});

test.afterAll(() => {
  restoreStock();
});

test("a buyer checks out from the product page and the order ends up paid", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = await watchBrowser(page);
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  const checkouts: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url() === `${BROWSER_API_URL}/v1/checkout`
    ) {
      checkouts.push(request);
    }
  });

  await logIn(page, buyer);
  await page.goto(`/produk/${SLUG}`);
  const article = page.getByRole("article", { name: NAME });
  await article.getByRole("button", { name: "Tambah ke keranjang" }).click();
  const added = article.locator(".add-to-cart").getByRole("status");
  await added.getByRole("link", { name: "Lihat keranjang" }).click();
  await expect(page).toHaveURL("/keranjang");
  await page
    .getByRole("button", { name: "Lanjut ke checkout" })
    .or(page.getByRole("link", { name: "Lanjut ke checkout" }))
    .click();
  await expect(page).toHaveURL("/checkout");

  // A buyer with no address gets the form at once.
  const form = page.getByRole("form", { name: "Alamat baru" });
  await expect(form.getByLabel("Nama alamat")).toHaveValue(ADDRESS.label);
  await form.getByLabel("Nama penerima").fill(ADDRESS.recipient_name);
  await form.getByLabel("Nomor telepon").fill(ADDRESS.phone);
  await form.getByLabel("Alamat lengkap").fill(ADDRESS.street);
  await form.getByLabel("Kota atau kabupaten").fill(ADDRESS.city);
  await form.getByLabel("Provinsi").fill(ADDRESS.province);
  await form.getByLabel("Kode pos").fill(ADDRESS.postal_code);
  await form.getByRole("button", { name: "Simpan alamat" }).click();
  await expect(
    page
      .getByRole("group", { name: "Pilih alamat pengiriman" })
      .getByRole("radio"),
  ).toBeChecked();

  const place = page.getByRole("button", { name: "Buat pesanan & bayar" });
  await expect(place).toBeDisabled();
  await expect(page.getByText("Pilih alamat dan kurir dulu.")).toBeVisible();
  await page
    .getByRole("group", { name: "Pilih layanan kurir" })
    .getByRole("radio", { name: /^JNE Reguler/ })
    .check();
  await expect(place).toBeEnabled();
  await place.click();

  // Placed, then paid with the test gateway: no page outside the shop,
  // straight to the order's payment page, which says how to pay.
  await expect(page).toHaveURL(PAYMENT_URL);
  const orderId = PAYMENT_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
  const order = await getOrder(token, orderId);
  expect(order.status).toBe("pending_payment");
  expect(order.latest_payment?.status).toBe("pending");
  expect(order.items).toEqual([
    expect.objectContaining({
      variant_id: variant.id,
      product_name: NAME,
      variant_name: variant.name,
      quantity: 1,
      unit_price: variant.price,
    }),
  ]);
  expect(order.shipping).toMatchObject({
    courier: "jne",
    service: "REG",
    address: {
      recipient_name: ADDRESS.recipient_name,
      phone: ADDRESS.phone,
      street: ADDRESS.street,
      city: ADDRESS.city,
      province: ADDRESS.province,
      postal_code: ADDRESS.postal_code,
    },
  });
  // One checkout, with an Idempotency-Key.
  expect(checkouts).toHaveLength(1);
  expect(checkouts[0]?.headers()["idempotency-key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  // The ordered line left the cart in the same transaction.
  const cart = await authCall<{ lines: unknown[] }>(
    token,
    "GET",
    "/v1/cart",
    200,
  );
  expect(cart.lines).toEqual([]);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pembayaran",
  );
  await expect(page.getByRole("link", { name: order.code })).toHaveAttribute(
    "href",
    `/pesanan/${orderId}`,
  );
  await expect(
    page.getByText(`Total ${rupiah(order.totals.total.amount)}`),
  ).toBeVisible();
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  await expect(page.getByText(/^Bayar sebelum /)).toBeVisible();
  await expect(
    page.getByText("Mode uji: gateway pembayaran palsu"),
  ).toBeVisible();
  await expect(
    page.getByText(`make fake-pay order=${order.code}`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lanjutkan pembayaran" }),
  ).toBeVisible();

  // The buyer pays; the page sees it by asking the API again.
  fakePay(order.code);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
    PAID_WITHIN,
  );
  await expect(page.getByText(/^Dibayar .+ Penjual akan segera/)).toBeVisible();
  await expect(
    page.getByText("Mode uji: gateway pembayaran palsu"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /bayar/i })).toHaveCount(0);
  expect((await getOrder(token, orderId)).status).toBe("paid");

  // The payment page replaced checkout in the history: Back goes to the
  // cart, which is empty now, never to a checkout for the same cart.
  await page.goBack();
  await expect(page).toHaveURL("/keranjang");
  expectNoProblems(problems);
});

test("Snap's redirect: the buyer leaves for Midtrans, comes back through the finish URL, and the page trusts the API, not the URL", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = await watchBrowser(page);
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  await createAddress(token);
  await addToCart(token, variant.id, 2);

  // The API pays with the test gateway; its answer becomes the Snap
  // redirect Midtrans would give (provider midtrans, an HTTPS URL on
  // midtrans.com), so the storefront's real redirect flow runs.
  let session: PaymentSessionRow | undefined;
  await page.route(`${BROWSER_API_URL}/v1/orders/*/pay`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: PaymentSessionRow };
    session = body.data;
    expect(session.provider).toBe("fake");
    await route.fulfill({
      response,
      json: {
        data: {
          ...session,
          provider: "midtrans",
          redirect_url: `${SNAP_ORIGIN}/snap/v4/redirection/${session.token}`,
        },
      },
    });
  });
  // Midtrans' hosted page: a link back to the finish URL, with what
  // Midtrans appends to it, including a transaction_status the page must
  // not believe.
  let midtransOrderId = "";
  await page.route(`${SNAP_ORIGIN}/**`, async (route) => {
    if (session === undefined) throw new Error("no payment session yet");
    midtransOrderId = providerOrderId(session.id);
    const finish = new URL("/pembayaran/selesai", WEB_URL);
    finish.searchParams.set("order_id", midtransOrderId);
    finish.searchParams.set("status_code", "200");
    finish.searchParams.set("transaction_status", "settlement");
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Midtrans</title><a href="${finish.href}">Kembali ke GoShop</a>`,
    });
  });

  await logIn(page, buyer);
  await page.goto("/checkout");
  await page
    .getByRole("group", { name: "Pilih layanan kurir" })
    .getByRole("radio", { name: /^JNE Reguler/ })
    .check();
  await page.getByRole("button", { name: "Buat pesanan & bayar" }).click();

  await expect(page).toHaveURL(
    new RegExp(`^${SNAP_ORIGIN}/snap/v4/redirection/fake-`),
  );
  if (session === undefined) throw new Error("the page never paid");
  const orderId = session.order_id;
  const order = await getOrder(token, orderId);
  expect(midtransOrderId.startsWith(`${order.code}-`)).toBe(true);

  // Back from Midtrans lands on the order's payment page, not on the
  // emptied checkout; Forward returns to Midtrans.
  await page.goBack();
  await expect(page).toHaveURL(`/pesanan/${orderId}/pembayaran`);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  // Not the test gateway's hint: this was a Midtrans payment.
  await expect(
    page.getByText("Mode uji: gateway pembayaran palsu"),
  ).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`^${SNAP_ORIGIN}/`));

  // The finish URL says "settlement" before anything is paid: the return
  // page goes to the remembered order's payment page, which still waits.
  await page.getByRole("link", { name: "Kembali ke GoShop" }).click();
  await expect(page).toHaveURL(`/pesanan/${orderId}/pembayaran`);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  expect((await getOrder(token, orderId)).status).toBe("pending_payment");

  // Midtrans' notification arrives; the page follows the API.
  fakePay(midtransOrderId);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
    PAID_WITHIN,
  );
  expect((await getOrder(token, orderId)).status).toBe("paid");
  expectNoProblems(problems);
});

test("the finish URL with no remembered payment, or another order's, says where to look instead of guessing", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await logIn(page, buyer);
  // This tab remembers a payment of another order (a code the API never
  // made), so the order_id below does not match it.
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "goshop:payment-return",
      JSON.stringify({
        orderId: "00000000-0000-4000-8000-000000000000",
        code: "GS-20260101-ZZZZZZ",
      }),
    );
  });
  await page.goto(
    "/pembayaran/selesai?order_id=GS-20261030-AAAAAA-BBBBBB&status_code=200&transaction_status=settlement",
  );
  await expect(page).toHaveURL(/\/pembayaran\/selesai\?/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pembayaran",
  );
  await expect(
    page.getByText(/^Terima kasih\. Status pembayaran Anda diperbarui/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Lihat pesanan saya" }).click();
  await expect(page).toHaveURL("/pesanan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pesanan saya",
  );
  expectNoProblems(problems);
});
