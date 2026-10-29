import { isApiError } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";

/** An Indonesian sentence for a payment that could not be started. */
export const payErrorMessage = (error: unknown): string => {
  if (isApiError(error, "PAYMENTS_DISABLED")) {
    return "Pembayaran sedang tidak tersedia di toko ini. Coba lagi nanti.";
  }
  if (isApiError(error, "PAYMENT_WINDOW_CLOSED")) {
    return "Batas waktu pembayaran pesanan ini sudah terlalu dekat, jadi pembayaran tidak bisa dimulai lagi.";
  }
  if (isApiError(error, "INVALID_TRANSITION")) {
    return "Pesanan ini sudah tidak menunggu pembayaran.";
  }
  if (isApiError(error, "UPSTREAM_UNAVAILABLE")) {
    return "Layanan pembayaran sedang tidak menjawab. Coba lagi sebentar lagi.";
  }
  if (isApiError(error, "INVALID_RESPONSE")) {
    return "Halaman pembayaran yang diterima tidak valid. Coba lagi, atau hubungi kami bila terus terjadi.";
  }
  if (isApiError(error, "UNAUTHORIZED")) {
    return "Sesi Anda sudah berakhir. Masuk lagi untuk membayar.";
  }
  return errorMessage(error);
};
