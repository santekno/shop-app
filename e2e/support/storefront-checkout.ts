// A buyer's checkout on the storefront, the way checkout-payment.spec.ts
// walks it (Bab 11 artikel 04): the product page, the cart, a new
// address, JNE Reguler, "Buat pesanan & bayar". For the Bab 12 specs that
// start from a real order placed in the browser.
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ADDRESS } from "./orders.ts";

/** The payment page's URL, capturing the order id. */
export const PAYMENT_URL = /\/pesanan\/([0-9a-f-]{36})\/pembayaran$/;

/**
 * Buys one unit of the product slug (named name) as the buyer logged in
 * on page, whose account has no address yet, and returns the new order's
 * id from the payment page's URL.
 */
export const checkoutOnStorefront = async (
  page: Page,
  slug: string,
  name: string,
): Promise<string> => {
  await page.goto(`/produk/${slug}`);
  const article = page.getByRole("article", { name });
  await article.getByRole("button", { name: "Tambah ke keranjang" }).click();
  const added = article.locator(".add-to-cart").getByRole("status");
  await added.getByRole("link", { name: "Lihat keranjang" }).click();
  await expect(page).toHaveURL("/keranjang");
  await page
    .getByRole("button", { name: "Lanjut ke checkout" })
    .or(page.getByRole("link", { name: "Lanjut ke checkout" }))
    .click();
  await expect(page).toHaveURL("/checkout");

  const form = page.getByRole("form", { name: "Alamat baru" });
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
  await page
    .getByRole("group", { name: "Pilih layanan kurir" })
    .getByRole("radio", { name: /^JNE Reguler/ })
    .check();
  await page.getByRole("button", { name: "Buat pesanan & bayar" }).click();
  await expect(page).toHaveURL(PAYMENT_URL);
  return PAYMENT_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
};
