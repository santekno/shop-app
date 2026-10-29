// Order history and detail (Bab 11 artikel 06): /pesanan lists the
// buyer's orders, newest first, ten at a time from GET /v1/orders with
// "Muat lebih banyak"; an unpaid order has "Bayar"; /pesanan/:id shows the
// order's own copy made at checkout.
//
// One buyer with eleven orders, placed through the API: six paid with the
// stack's test gateway, then five unpaid (the API's limit), so the list
// has two pages and both kinds of row.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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
  placeOrder,
  productVariants,
  registerVerifiedBuyer,
  startPayment,
} from "../support/orders.ts";
import type { OrderRow, OrderSummaryRow } from "../support/orders.ts";
import { logIn } from "../support/session.ts";

/** A seeded product no other spec opens; its stock is put back afterwards. */
const SLUG = "keripik-singkong-balado-200g";
const PAID = 6;
const UNPAID = 5;
/** The storefront's page size for the history (OrdersPage). */
const PAGE = 10;

/** The labels of ORDER_STATUS_LABEL the rows show. */
const LABEL: Readonly<Record<string, string>> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
};

let buyer: Account;
let token: string;
let restoreStock: () => void;
/** Every order of the buyer, newest first, as GET /v1/orders lists them. */
let orders: OrderSummaryRow[];

test.beforeAll(async () => {
  test.setTimeout(120_000);
  clearRateLimits();
  buyer = await registerVerifiedBuyer("history");
  token = await apiLogin(buyer);
  restoreStock = await keepStock(SLUG);
  const addressId = await createAddress(token);
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  for (let i = 0; i < PAID + UNPAID; i++) {
    await addToCart(token, variant.id, 1);
    const order = await placeOrder(token, addressId);
    if (i < PAID) {
      await startPayment(token, order.id);
      fakePay(order.code);
    }
  }
  orders = await authCall<OrderSummaryRow[]>(
    token,
    "GET",
    "/v1/orders?limit=50",
    200,
  );
  expect(orders.map((order) => order.status)).toEqual([
    ...Array<string>(UNPAID).fill("pending_payment"),
    ...Array<string>(PAID).fill("paid"),
  ]);
});

// Each test logs this buyer in; the per-email login limit is 5 in 15
// minutes, and the counters are the local stack's own.
test.beforeEach(() => {
  clearRateLimits();
});

test.afterAll(async () => {
  for (const order of orders) {
    if (order.status === "pending_payment") {
      await authCall(token, "POST", `/v1/orders/${order.id}/cancel`, 200);
    }
  }
  restoreStock();
});

const orderList = (page: Page) =>
  page.getByRole("list", { name: "Daftar pesanan" });

const rows = (page: Page) => orderList(page).getByRole("listitem");

/** The order (from the API's list) with this status, the newest first. */
const firstWith = (status: string): OrderSummaryRow => {
  const order = orders.find((row) => row.status === status);
  if (order === undefined) throw new Error(`no ${status} order`);
  return order;
};

test("lists the orders newest first, ten at a time; 'Muat lebih banyak' loads the rest and moves the focus to the first new one", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await logIn(page, buyer);
  await page.goto("/pesanan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pesanan saya",
  );
  await expect(rows(page)).toHaveCount(PAGE);

  const more = page.getByRole("button", { name: "Muat lebih banyak" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(rows(page)).toHaveCount(orders.length);
  const firstNew = rows(page)
    .nth(PAGE)
    .getByRole("link", {
      name: orders[PAGE]?.code ?? "",
    });
  await expect(firstNew).toBeFocused();
  // The last page: no button.
  await expect(more).toHaveCount(0);

  for (const [index, order] of orders.entries()) {
    const row = rows(page).nth(index);
    const code = row.getByRole("link", { name: order.code, exact: true });
    await expect(code).toHaveAttribute("href", `/pesanan/${order.id}`);
    await expect(row).toContainText(LABEL[order.status] ?? order.status);
    await expect(row).toContainText(rupiah(order.total.amount));
    // "Bayar" only on an unpaid order, named for a screen reader.
    const pay = row.getByRole("link", { name: `Bayar pesanan ${order.code}` });
    if (order.status === "pending_payment") {
      await expect(pay).toHaveText("Bayar");
      await expect(pay).toHaveAttribute(
        "href",
        `/pesanan/${order.id}/pembayaran`,
      );
    } else {
      await expect(pay).toHaveCount(0);
    }
  }
  expectNoProblems(problems);
});

test("'Bayar' on an unpaid order opens its payment page", async ({ page }) => {
  const problems = await watchBrowser(page);
  const order = firstWith("pending_payment");
  await logIn(page, buyer);
  await page.goto("/pesanan");
  await page.getByRole("link", { name: `Bayar pesanan ${order.code}` }).click();
  await expect(page).toHaveURL(`/pesanan/${order.id}/pembayaran`);
  await expect(page.locator("p.payment-status")).toHaveText(
    "Menunggu pembayaran.",
  );
  await expect(page.getByRole("link", { name: order.code })).toBeVisible();
  expectNoProblems(problems);
});

/** The order detail's checks shared by a paid and an unpaid order. */
const expectOrderBody = async (page: Page, order: OrderRow) => {
  const item = order.items[0];
  if (item === undefined) throw new Error(`${order.code} has no item`);
  const lines = page.getByRole("list", { name: "Barang dalam pesanan" });
  await expect(lines.getByRole("listitem")).toHaveCount(1);
  await expect(lines.getByRole("listitem")).toHaveText(
    `${item.product_name} (${item.variant_name}) · 1 × ${rupiah(item.unit_price.amount)}${rupiah(item.line_total.amount)}`,
  );
  const value = (term: string) => page.locator(`dt:text-is("${term}") + dd`);
  await expect(value("Subtotal")).toHaveText(
    rupiah(order.totals.subtotal.amount),
  );
  await expect(value("Ongkos kirim")).toHaveText(
    rupiah(order.totals.shipping_fee.amount),
  );
  await expect(value("Total")).toHaveText(rupiah(order.totals.total.amount));
  await expect(value("Kurir")).toHaveText("JNE REG");
  await expect(value("Nomor resi")).toHaveText("Belum dikirim");
  await expect(value("Alamat")).toHaveText(
    `${ADDRESS.recipient_name} · ${ADDRESS.phone}${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.province} ${ADDRESS.postal_code}`,
  );
};

test("a paid order's page shows its own copy: lines, totals, shipping and timeline", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const summary = firstWith("paid");
  const order = await getOrder(token, summary.id);
  await logIn(page, buyer);
  await page.goto("/pesanan");
  await page.getByRole("link", { name: order.code, exact: true }).click();
  await expect(page).toHaveURL(`/pesanan/${order.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Detail pesanan",
  );
  await expect(page.getByText(order.code, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Dibayar", { exact: true }).first(),
  ).toBeVisible();
  await expectOrderBody(page, order);
  const timeline = page
    .getByRole("region", { name: "Riwayat" })
    .or(page.locator("section", { hasText: "Riwayat" }))
    .getByRole("listitem");
  await expect(timeline).toHaveCount(2);
  await expect(timeline.nth(0)).toContainText("Dibuat");
  await expect(timeline.nth(1)).toContainText("Dibayar");
  await expect(timeline.nth(1).locator("time")).toHaveAttribute(
    "datetime",
    order.paid_at ?? "",
  );
  // Paid: nothing to pay.
  await expect(page.getByRole("button", { name: /bayar/i })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Lihat status pembayaran" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "← Pesanan saya" }).click();
  await expect(page).toHaveURL("/pesanan");
  expectNoProblems(problems);
});

test("an unpaid order's page offers to pay and links to its payment status", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const summary = firstWith("pending_payment");
  const order = await getOrder(token, summary.id);
  await logIn(page, buyer);
  await page.goto(`/pesanan/${order.id}`);
  await expect(
    page.getByText("Menunggu pembayaran", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/^Bayar sebelum /)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bayar sekarang" }),
  ).toBeVisible();
  await expectOrderBody(page, order);
  await page.getByRole("link", { name: "Lihat status pembayaran" }).click();
  await expect(page).toHaveURL(`/pesanan/${order.id}/pembayaran`);
  expectNoProblems(problems);
});

test("an order id the API does not know is shown as not found", async ({
  page,
}) => {
  await logIn(page, buyer);
  await page.goto("/pesanan/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Detail pesanan",
  );
  await expect(page.getByText("Pesanan ini tidak ditemukan.")).toBeVisible();
});
