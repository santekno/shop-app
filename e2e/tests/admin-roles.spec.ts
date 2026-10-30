// Roles in the dashboard (Bab 12 artikel 08): a seller runs the orders but
// cannot cancel one. The dashboard hides "Batalkan pesanan" from a seller
// and says who can, and the API refuses the seller's cancel on its own
// (403), whatever the page shows. An admin on the same order can cancel,
// which gives the stock back.
//
// Both staff accounts come from `make seed-admin` (global-setup.ts).
import { expect, test } from "@playwright/test";
import { clearRateLimits } from "../support/accounts.ts";
import { ADMIN, SELLER, adminLogIn, adminUrl } from "../support/admin.ts";
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

/** A seeded product no other spec orders; its stock is put back after. */
const SLUG = "power-bank-10000mah";

let restoreStock: () => void;
let order: OrderRow;
let buyerToken: string;
let variantId: string;

test.beforeAll(async () => {
  clearRateLimits();
  restoreStock = await keepStock(SLUG);
  const buyer = await registerVerifiedBuyer("peran");
  buyerToken = await apiLogin(buyer);
  const addressId = await createAddress(buyerToken);
  const [variant] = await productVariants(SLUG);
  if (variant === undefined) throw new Error(`${SLUG} has no variant`);
  variantId = variant.id;
  await addToCart(buyerToken, variant.id, 2);
  order = await placeOrder(buyerToken, addressId);
  await startPayment(buyerToken, order.id);
  fakePay(order.code);
  await expect
    .poll(async () => (await getOrder(buyerToken, order.id)).status)
    .toBe("paid");
});

test.afterAll(() => {
  restoreStock();
});

test("a seller can process an order but has no cancel, and the API refuses one", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await adminLogIn(page, SELLER, `/pesanan/${order.id}`);
  await expect(page).toHaveURL(adminUrl(`/pesanan/${order.id}`));
  const actions = page.getByRole("region", { name: "Tindakan" });
  await expect(
    actions.getByRole("button", { name: "Proses pesanan" }),
  ).toBeVisible();
  await expect(
    actions.getByRole("button", { name: "Batalkan pesanan" }),
  ).toHaveCount(0);
  await expect(actions).toContainText(
    "Pembatalan pesanan dilakukan oleh admin toko.",
  );

  // The page is not the guard: the API refuses the seller's cancel.
  const sellerToken = await apiLogin(SELLER);
  await authCall(
    sellerToken,
    "POST",
    `/v1/admin/orders/${order.id}/cancel`,
    403,
  );
  expect((await getOrder(buyerToken, order.id)).status).toBe("paid");
  expectNoProblems(problems);
});

test("an admin cancels the same order, and its stock comes back", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const before = (await productVariants(SLUG)).find((v) => v.id === variantId);
  await adminLogIn(page, ADMIN, `/pesanan/${order.id}`);
  const actions = page.getByRole("region", { name: "Tindakan" });
  await actions.getByRole("button", { name: "Batalkan pesanan" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: `Batalkan pesanan ${order.code}?`,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Batalkan pesanan" }).click();
  await expect(dialog).toBeHidden();
  await expect(actions.getByRole("status")).toHaveText(
    `Pesanan ${order.code} dibatalkan. Stok dan voucher sudah dikembalikan.`,
  );
  const cancelled = await getOrder(buyerToken, order.id);
  expect(cancelled.status).toBe("cancelled");
  const after = (await productVariants(SLUG)).find((v) => v.id === variantId);
  expect(after?.stock).toBe((before?.stock ?? 0) + 2);
  expectNoProblems(problems);
});
