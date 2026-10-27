import { isApiError } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";

/**
 * An Indonesian sentence for an error of the checkout's API calls
 * (shipping quotes, the preview, placing the order). Each code says what
 * the buyer can do next; anything unknown falls back to the storefront's
 * general text.
 */
export const checkoutErrorMessage = (error: unknown): string => {
  if (isApiError(error, "SHIPPING_UNAVAILABLE")) {
    return "Tidak ada kurir yang melayani kode pos alamat ini. Pilih atau tambahkan alamat lain.";
  }
  if (isApiError(error, "UPSTREAM_UNAVAILABLE")) {
    return "Layanan ongkos kirim sedang tidak menjawab. Coba lagi sebentar lagi.";
  }
  if (isApiError(error, "CART_EMPTY")) {
    return "Keranjang Anda kosong. Tambahkan barang dulu.";
  }
  if (isApiError(error, "CART_CHANGED")) {
    return "Keranjang Anda berubah saat pesanan dibuat (misalnya dari perangkat lain). Periksa ringkasan di bawah, lalu coba lagi.";
  }
  if (isApiError(error, "CHECKOUT_PROBLEMS")) {
    return "Ada barang yang tidak bisa dibeli seperti sekarang. Perbaiki di keranjang, lalu kembali ke sini.";
  }
  if (isApiError(error, "EMAIL_UNVERIFIED")) {
    return "Verifikasi email Anda dulu sebelum membuat pesanan. Buka tautan verifikasi yang kami kirim ke email Anda.";
  }
  if (isApiError(error, "TOO_MANY_PENDING_ORDERS")) {
    return "Anda sudah punya 5 pesanan yang belum dibayar. Bayar atau batalkan salah satunya dulu.";
  }
  if (isApiError(error, "VALIDATION_FAILED")) {
    return "Alamat atau layanan kurir yang dipilih sudah tidak berlaku. Pilih lagi.";
  }
  if (isApiError(error, "UNAUTHORIZED")) {
    return "Sesi Anda sudah berakhir. Masuk lagi untuk melanjutkan.";
  }
  return errorMessage(error);
};
