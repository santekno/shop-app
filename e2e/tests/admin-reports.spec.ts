// The sales report (Bab 12 artikel 07) with real data: an order is placed
// and paid on the stack, and the report page shows the numbers the API
// computed for the range, the chart and its table, and the product among
// the best sellers.
import { expect, test } from "@playwright/test";
import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import { clearRateLimits } from "../support/accounts.ts";
import { ADMIN, adminLogIn } from "../support/admin.ts";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems, fetchProduct } from "../support/catalog.ts";
import {
  addToCart,
  apiLogin,
  createAddress,
  fakePay,
  getOrder,
  keepStock,
  placeOrder,
  productVariants,
  registerVerifiedBuyer,
  startPayment,
} from "../support/orders.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** A seeded product no other spec orders; its stock is put back after. */
const SLUG = "kabel-data-usb-c";

let restoreStock: () => void;

test.beforeAll(async () => {
  clearRateLimits();
  restoreStock = await keepStock(SLUG);
  const buyer = await registerVerifiedBuyer("laporan");
  const token = await apiLogin(buyer);
  const addressId = await createAddress(token);
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  await addToCart(token, variant.id, 3);
  const order = await placeOrder(token, addressId);
  await startPayment(token, order.id);
  fakePay(order.code);
  await expect
    .poll(async () => (await getOrder(token, order.id)).status)
    .toBe("paid");
});

test.afterAll(() => {
  restoreStock();
});

test("the report shows the API's numbers for the last 7 days, with today's sale in them", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct(SLUG);
  const reportResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${BROWSER_API_URL}/v1/admin/reports/sales?`) &&
      response.status() === 200,
  );
  await adminLogIn(page, ADMIN, "/laporan?rentang=7");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Laporan");
  const report = (
    (await (await reportResponse).json()) as { data: SalesReport }
  ).data;
  expect(report.totals.order_count).toBeGreaterThan(0);

  const tile = (label: string) => page.locator(`dt:text-is("${label}") + dd`);
  await expect(tile("Pendapatan")).toHaveText(
    formatRupiah(report.totals.revenue),
  );
  await expect(tile("Pesanan")).toHaveText(
    report.totals.order_count.toLocaleString("id-ID"),
  );
  await expect(tile("Rata-rata per pesanan")).toHaveText(
    formatRupiah(report.totals.average_order_value),
  );

  // The chart is drawn (an SVG from Recharts), and its numbers are also a
  // table, one row per day of the range.
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await page.getByText("Lihat data dalam tabel").first().click();
  const days = page
    .getByRole("region", { name: "Data penjualan per hari" })
    .first();
  await expect(days.locator("tbody tr")).toHaveCount(report.series.length);

  // Today's sale makes the product a best seller of the range.
  const top = page.getByRole("region", { name: "Produk terlaris" }).last();
  await expect(top.getByRole("rowheader")).toHaveText(
    report.top_products.map((row) => row.name),
  );
  await expect(top).toContainText(product.name);
  expectNoProblems(problems);
});
