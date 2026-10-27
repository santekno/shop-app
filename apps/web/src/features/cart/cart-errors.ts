import { isApiError } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";

/**
 * An Indonesian sentence for a failed change to the cart. The cart's own
 * conflicts (409) have their own text; a network, timeout or rate-limit
 * problem gets the storefront's general one; an ended session says so;
 * anything else says that the item did not go in.
 */
export const cartErrorMessage = (error: unknown): string => {
  if (isApiError(error, "INSUFFICIENT_STOCK")) {
    const { available } = error.details;
    return typeof available === "number"
      ? `Stok tidak cukup. Tersedia ${available}, termasuk yang sudah ada di keranjang Anda.`
      : "Stok tidak cukup untuk jumlah ini.";
  }
  if (isApiError(error, "QUANTITY_LIMIT")) {
    return "Satu barang paling banyak 99 buah per keranjang.";
  }
  if (isApiError(error, "CART_FULL")) {
    return "Keranjang sudah berisi 50 jenis barang. Hapus salah satu dulu.";
  }
  if (isApiError(error, "VARIANT_UNAVAILABLE")) {
    return "Varian ini sudah tidak dijual.";
  }
  if (isApiError(error, "CART_NOT_FOUND")) {
    return "Keranjang sebelumnya sudah tidak berlaku. Silakan tambahkan lagi.";
  }
  if (isApiError(error, "NETWORK_ERROR", "CLIENT_TIMEOUT", "TIMEOUT")) {
    return errorMessage(error);
  }
  if (isApiError(error, "RATE_LIMITED")) return errorMessage(error);
  // Only a logged-in add gets it: the session ended while it was on its way.
  if (isApiError(error, "UNAUTHORIZED")) {
    return "Sesi Anda sudah berakhir. Masuk lagi, lalu tambahkan barang ini.";
  }
  return "Barang belum masuk ke keranjang. Coba lagi.";
};
