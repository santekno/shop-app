// The payment status page (Bab 11 artikel 05): /pesanan/:id/pembayaran
// asks GET /v1/orders/{id} again while the order waits for its payment,
// slower each time (2 s, 2 s, 3 s … every 30 s), never in a hidden tab,
// stops on a final answer, and stops by itself after a 15-minute round
// until the buyer presses "Periksa lagi".
//
// Time is Playwright's clock: page.clock.fastForward jumps the page's
// clock and fires each timer that came due once, so a 15-minute round or
// a payment deadline takes no real time, and no test sleeps longer than
// one of the page's own intervals. The orders are real (placed through
// the API) and are paid with the stack's test gateway (`api fake-pay`).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { clearRateLimits } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems } from "../support/catalog.ts";
import {
  addToCart,
  apiLogin,
  authCall,
  createAddress,
  fakePay,
  getOrder,
  keepStock,
  placeOrder,
  productVariants,
  registerVerifiedBuyer,
  startPayment,
} from "../support/orders.ts";
import type { OrderRow } from "../support/orders.ts";
import { logIn } from "../support/session.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** A seeded product no other spec opens; its stock is put back afterwards. */
const SLUG = "lampu-tidur-rotan";

/** The longest wait between two checks (POLL_DELAYS_MS' last step). */
const SLOWEST_POLL_MS = 30_000;

let buyer: Account;
let token: string;
let addressId: string;
let restoreStock: () => void;
const placed: string[] = [];

test.beforeAll(async () => {
  clearRateLimits();
  buyer = await registerVerifiedBuyer("polling");
  token = await apiLogin(buyer);
  addressId = await createAddress(token);
  restoreStock = await keepStock(SLUG);
});

// Every test logs this buyer in; five logins per email in 15 minutes is
// the API's limit, and the counters are the local stack's own.
test.beforeEach(() => {
  clearRateLimits();
});

test.afterAll(async () => {
  // An unpaid order holds stock until it expires; cancel what is left,
  // then put the product's stock back as it was.
  for (const id of placed) {
    const order = await getOrder(token, id);
    if (order.status === "pending_payment") {
      await authCall(token, "POST", `/v1/orders/${id}/cancel`, 200);
    }
  }
  restoreStock();
});

/** A new order of one item, waiting for payment, with no payment started. */
const newOrder = async (): Promise<OrderRow> => {
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  await addToCart(token, variant.id, 1);
  const order = await placeOrder(token, addressId);
  placed.push(order.id);
  return order;
};

/** Every GET of the order the page sends, as it sends them. */
const orderChecks = (page: Page, orderId: string): string[] => {
  const checks: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url() === `${BROWSER_API_URL}/v1/orders/${orderId}`
    ) {
      checks.push(request.url());
    }
  });
  return checks;
};

/**
 * Waits long enough for a check the page would have sent to show up:
 * fastForward fires the timers synchronously, and a fetch they start is a
 * request at once. Far shorter than the page's shortest interval.
 */
const settle = (page: Page) => page.waitForTimeout(500);

/** The sentence of the payment page's live region. */
const paymentStatus = (page: Page) => page.locator("p.payment-status");

/** Opens the payment page of order with the page's clock under control. */
const openPaymentPage = async (page: Page, order: OrderRow) => {
  await page.clock.install();
  await logIn(page, buyer);
  const checks = orderChecks(page, order.id);
  await page.goto(`/pesanan/${order.id}/pembayaran`);
  await expect(paymentStatus(page)).toBeVisible();
  return checks;
};

test("a pending order shows its state and keeps checking; paid while the page is open, it switches to paid and the checks stop", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const order = await newOrder();
  const checks = await openPaymentPage(page, order);

  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  await expect(paymentStatus(page)).toHaveAttribute("role", "status");
  await expect(
    page.getByText(/^Bayar sebelum .+ Halaman ini diperbarui sendiri/),
  ).toBeVisible();
  await expect(
    page.getByText(/^Diperiksa otomatis\. Terakhir diperiksa /),
  ).toBeVisible();
  // No payment started yet, and opened directly (no checkout hand-over):
  // "Bayar sekarang", and no test gateway hint.
  await expect(
    page.getByRole("button", { name: "Bayar sekarang" }),
  ).toBeVisible();
  await expect(
    page.getByText("Mode uji: gateway pembayaran palsu"),
  ).toHaveCount(0);

  // Still waiting: the page asks again, and the answer stays the same.
  const before = checks.length;
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect.poll(() => checks.length).toBeGreaterThan(before);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  // The buyer opens the payment elsewhere (another tab, the app): the
  // next check offers to continue it rather than to start another.
  await startPayment(token, order.id);
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect(
    page.getByRole("button", { name: "Lanjutkan pembayaran" }),
  ).toBeVisible();
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  // Paid while the page is open: the next check brings "paid".
  fakePay(order.code);
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
  );
  await expect(page.getByText(/^Dibayar .+ Penjual akan segera/)).toBeVisible();
  await expect(page.getByRole("button", { name: /bayar/i })).toHaveCount(0);
  await expect(page.getByText(/Terakhir diperiksa/)).toHaveCount(0);

  // A final answer ends the polling: minutes later, no further check.
  const atPaid = checks.length;
  for (let i = 0; i < 4; i++) await page.clock.fastForward(SLOWEST_POLL_MS);
  await settle(page);
  expect(checks.length).toBe(atPaid);
  expectNoProblems(problems);
});

test("after a 15-minute round the page stops checking, and 'Periksa lagi' starts a new round from the fast end", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const order = await newOrder();
  await startPayment(token, order.id);
  const checks = await openPaymentPage(page, order);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  // The round's limit passes: the next answer ends it.
  await page.clock.fastForward("15:30");
  const again = page.getByRole("button", { name: "Periksa lagi" });
  await expect(again).toBeVisible();
  await expect(
    page.getByText(/^Pemeriksaan otomatis berhenti\. Terakhir diperiksa /),
  ).toBeVisible();
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  // Stopped: no check however long the tab stays open.
  const atStop = checks.length;
  for (let i = 0; i < 4; i++) await page.clock.fastForward(SLOWEST_POLL_MS);
  await settle(page);
  expect(checks.length).toBe(atStop);

  // "Periksa lagi" asks at once and starts a new round: the next check
  // comes after the first step of the backoff (2 s), not after 30 s.
  await again.click();
  await expect.poll(() => checks.length).toBe(atStop + 1);
  await expect(again).toHaveCount(0);
  await expect(page.getByText(/^Diperiksa otomatis\./)).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect.poll(() => checks.length).toBe(atStop + 2);

  // The new round ends like any other: paid, then no more checks.
  fakePay(order.code);
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
  );
  expectNoProblems(problems);
});

test("a hidden tab does not check; showing it again checks at once", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const order = await newOrder();
  await startPayment(token, order.id);
  await page.addInitScript(() => {
    // The page's visibility, switched by the test (a real tab switch
    // cannot be made in a headless browser).
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => state === "hidden",
    });
    Object.assign(window, {
      __setVisibility: (next: DocumentVisibilityState) => {
        state = next;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });
  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((next) => {
      (
        window as unknown as {
          __setVisibility: (state: DocumentVisibilityState) => void;
        }
      ).__setVisibility(next);
    }, state);

  const checks = await openPaymentPage(page, order);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  await setVisibility("hidden");
  await settle(page);
  const hidden = checks.length;
  // Paid meanwhile, but nobody is looking: no check for minutes.
  fakePay(order.code);
  for (let i = 0; i < 4; i++) await page.clock.fastForward(SLOWEST_POLL_MS);
  await settle(page);
  expect(checks.length).toBe(hidden);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");

  // Back on the tab: one check at once, without waiting for a timer.
  await setVisibility("visible");
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
  );
  expect(checks.length).toBe(hidden + 1);
  expectNoProblems(problems);
});

test("a denied payment leaves the order payable: the page says so, keeps checking, and 'Coba bayar lagi' opens a new payment", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const order = await newOrder();
  await startPayment(token, order.id);
  const checks = await openPaymentPage(page, order);

  // A payment is open at the gateway.
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  await expect(
    page.getByRole("button", { name: "Lanjutkan pembayaran" }),
  ).toBeVisible();

  fakePay(order.code, "deny");
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran ditolak. Coba lagi, dengan metode pembayaran lain bila perlu.",
  );
  expect((await getOrder(token, order.id)).status).toBe("pending_payment");

  // Still waiting for a payment, so still checking.
  const atDenied = checks.length;
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect.poll(() => checks.length).toBeGreaterThan(atDenied);

  // A new payment with the test gateway: the same page, now with the hint.
  await page.getByRole("button", { name: "Coba bayar lagi" }).click();
  await expect(
    page.getByText("Mode uji: gateway pembayaran palsu"),
  ).toBeVisible();
  await expect(page).toHaveURL(`/pesanan/${order.id}/pembayaran`);
  await expect(paymentStatus(page)).toHaveText("Menunggu pembayaran.");
  expect((await getOrder(token, order.id)).latest_payment?.status).toBe(
    "pending",
  );

  fakePay(order.code);
  await page.clock.fastForward(SLOWEST_POLL_MS);
  await expect(paymentStatus(page)).toHaveText(
    "Pembayaran diterima. Terima kasih!",
  );
  expectNoProblems(problems);
});

test("past the payment deadline the page waits for the expiry job instead of offering to pay", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const order = await newOrder();
  await openPaymentPage(page, order);
  await expect(
    page.getByRole("button", { name: "Bayar sekarang" }),
  ).toBeVisible();

  // The browser's clock passes payment_expires_at (24 hours); the API's
  // expiry job has not run, so the order still waits.
  const deadline = Date.parse(order.payment_expires_at);
  const now = await page.evaluate(() => Date.now());
  await page.clock.fastForward(deadline - now + 60_000);
  await expect(paymentStatus(page)).toHaveText(
    "Batas waktu pembayaran sudah lewat. Menunggu konfirmasi akhir…",
  );
  await expect(page.getByRole("button", { name: /bayar/i })).toHaveCount(0);
  await expect(page.getByText(/^Bayar sebelum/)).toHaveCount(0);
  expectNoProblems(problems);
});
