// The whole sale, buyer to courier (Bab 12 artikel 12): a buyer checks out
// on the storefront and pays with the stack's test gateway; the admin
// dashboard, already open, gets the order live (ADR 0009: outbox → worker
// → Redis → GET /v1/admin/events) as a toast and an unread badge; the
// admin opens the order, processes it, ships it with a resi and prints its
// label; the buyer's order page then says it is on its way.
//
// Everything is real: the storefront and dashboard containers, the API,
// the worker's dispatcher and Postgres. Only the payment is the test
// gateway's (`api fake-pay`), which sends the API the signed notification
// Midtrans would.
import { expect, test } from "@playwright/test";
import { formatRupiah } from "@goshop/shared";
import { clearRateLimits } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import {
  ADMIN,
  adminLogIn,
  adminNav,
  expectFeedLive,
} from "../support/admin.ts";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems, fetchProduct } from "../support/catalog.ts";
import {
  ADDRESS,
  apiLogin,
  fakePay,
  getOrder,
  keepStock,
  registerVerifiedBuyer,
} from "../support/orders.ts";
import { logIn } from "../support/session.ts";
import { checkoutOnStorefront } from "../support/storefront-checkout.ts";
import { ADMIN_URL } from "../support/stack.ts";

/** A seeded product no other spec orders; its stock is put back after. */
const SLUG = "rice-cooker-1-8-liter";

let buyer: Account;
let token: string;
let restoreStock: () => void;

test.beforeAll(async () => {
  clearRateLimits();
  buyer = await registerVerifiedBuyer("alur-admin");
  token = await apiLogin(buyer);
  restoreStock = await keepStock(SLUG);
});

test.afterAll(() => {
  restoreStock();
});

test("a storefront order reaches the open dashboard live, and the admin ships it", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const product = await fetchProduct(SLUG);

  // The admin's dashboard, in a browser of its own, open on the overview.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const adminProblems = await watchBrowser(admin);
  await adminLogIn(admin, ADMIN);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Ringkasan",
  );
  await expectFeedLive(admin);
  const ordersLink = adminNav(admin).getByRole("link", { name: /^Pesanan/ });
  await expect(ordersLink).toHaveAccessibleName("Pesanan");

  // The buyer checks out and pays.
  const buyerProblems = await watchBrowser(page);
  await logIn(page, buyer);
  const orderId = await checkoutOnStorefront(page, SLUG, product.name);
  const placed = await getOrder(token, orderId);
  expect(placed.status).toBe("pending_payment");
  fakePay(placed.code);
  await expect(page.locator("p.payment-status")).toHaveText(
    "Pembayaran diterima. Terima kasih!",
    { timeout: 30_000 },
  );

  // The dashboard hears of it without a reload: a toast naming the order
  // and its total, and the unread count on "Pesanan". The worker
  // publishes the outbox every 5 seconds.
  const toasts = admin.getByRole("region", { name: "Notifikasi pesanan" });
  const message = `Pesanan baru ${placed.code} · ${formatRupiah({ amount: placed.totals.total.amount, currency: "IDR" })}`;
  const toast = toasts.getByRole("listitem").filter({ hasText: message });
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(ordersLink).toHaveAccessibleName("Pesanan 1 pesanan baru");
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Ringkasan",
  );

  // The toast leads to the paid queue, which clears the count.
  await toast.getByRole("link", { name: "Lihat pesanan" }).click();
  await expect(admin).toHaveURL(`${ADMIN_URL}/pesanan`);
  await expect(ordersLink).toHaveAccessibleName("Pesanan");
  const queue = admin.getByRole("region", { name: "Pesanan dibayar" });
  await queue.getByRole("link", { name: placed.code }).click();
  await expect(admin).toHaveURL(`${ADMIN_URL}/pesanan/${orderId}`);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    "Detail pesanan",
  );
  await expect(
    admin.getByText(placed.code, { exact: true }).first(),
  ).toBeVisible();

  // Process, then ship with the courier's resi (typed in lower case; the
  // form stores it upper-cased).
  const actions = admin.getByRole("region", { name: "Tindakan" });
  await actions.getByRole("button", { name: "Proses pesanan" }).click();
  await expect(actions.getByRole("status")).toHaveText(
    `Pesanan ${placed.code} sedang diproses. Kemas barangnya, lalu kirim dengan nomor resi.`,
  );
  const resi = `jne${String(Date.now()).slice(-10)}`;
  const ship = actions.getByRole("form", { name: "Kirim pesanan" });
  await ship.getByLabel("Nomor resi").fill(resi);
  await ship.getByRole("button", { name: "Tandai dikirim" }).click();
  await expect(actions.getByRole("status")).toHaveText(
    `Pesanan ${placed.code} ditandai dikirim. Pembeli dapat melacaknya dengan nomor resi.`,
  );
  const shipped = await getOrder(token, orderId);
  expect(shipped.status).toBe("shipped");
  expect(shipped.shipping.tracking_number).toBe(resi.toUpperCase());

  // The label: the page is the paper, and "Cetak" opens the print dialog.
  await admin.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await admin.getByRole("link", { name: "Cetak resi" }).click();
  await expect(admin).toHaveURL(`${ADMIN_URL}/pesanan/${orderId}/resi`);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
    `Resi pengiriman ${placed.code}`,
  );
  const label = admin.getByRole("region", { name: "Label pengiriman" });
  await expect(label).toContainText(resi.toUpperCase());
  await expect(label).toContainText("JNE REG");
  await expect(label).toContainText(ADDRESS.recipient_name);
  await expect(label).toContainText(ADDRESS.postal_code);
  await expect(label).toContainText(placed.code);
  await expect(label).toContainText("Dikirim");
  await expect(admin.getByRole("alert")).toHaveCount(0);
  await admin.getByRole("button", { name: "Cetak" }).click();
  expect(
    await admin.evaluate(
      () => (window as unknown as { printed: number }).printed,
    ),
  ).toBe(1);

  // The buyer's order page says it is on its way, with the resi.
  await page.goto(`/pesanan/${orderId}`);
  await expect(
    page.getByText("Dikirim", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(`dt:text-is("Nomor resi") + dd`)).toHaveText(
    resi.toUpperCase(),
  );

  expectNoProblems(buyerProblems);
  expectNoProblems(adminProblems);
  await adminContext.close();
});
