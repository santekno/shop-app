import { formatRupiah, isApiError } from "@goshop/shared";
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
  if (isApiError(error, "VOUCHER_NOT_APPLICABLE")) {
    return voucherErrorMessage(error);
  }
  if (isApiError(error, "VALIDATION_FAILED")) {
    return "Alamat atau layanan kurir yang dipilih sudah tidak berlaku. Pilih lagi.";
  }
  if (isApiError(error, "UNAUTHORIZED")) {
    return "Sesi Anda sudah berakhir. Masuk lagi untuk melanjutkan.";
  }
  return errorMessage(error);
};

/**
 * Why a voucher does not apply (409 VOUCHER_NOT_APPLICABLE), from its
 * `details.reason`. A promo that has not started yet answers `not_found`,
 * like a code that does not exist (the API's choice, so codes cannot be
 * guessed early), and the text says only that.
 */
export const voucherErrorMessage = (error: unknown): string => {
  if (!isApiError(error, "VOUCHER_NOT_APPLICABLE")) {
    return checkoutErrorMessage(error);
  }
  const { reason, min_spend: minSpend } = error.details;
  switch (reason) {
    case "expired":
      return "Voucher ini sudah tidak berlaku.";
    case "exhausted":
      return "Kuota voucher ini sudah habis.";
    case "per_user_limit":
      return "Anda sudah memakai voucher ini sebanyak batas yang boleh.";
    case "min_spend":
      return typeof minSpend === "object" &&
        minSpend !== null &&
        "amount" in minSpend &&
        typeof minSpend.amount === "number"
        ? `Voucher ini berlaku untuk belanja minimal ${formatRupiah({ amount: minSpend.amount, currency: "IDR" })}.`
        : "Belanja Anda belum mencapai minimum voucher ini.";
    default:
      return "Kode voucher tidak ditemukan.";
  }
};
