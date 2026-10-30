import { isApiError } from "@goshop/shared";

/**
 * A short Indonesian sentence for an error the user can do something about.
 * The API's own `message` is English and meant for developers, so the UI
 * picks its text from the error code instead.
 */
export const errorMessage = (error: unknown): string => {
  if (isApiError(error, "NETWORK_ERROR")) {
    return "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.";
  }
  if (isApiError(error, "CLIENT_TIMEOUT", "TIMEOUT")) {
    return "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.";
  }
  if (isApiError(error, "RATE_LIMITED")) {
    return "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.";
  }
  return "Terjadi kesalahan saat memuat data. Coba lagi.";
};

/** The X-Request-ID to quote when reporting a problem, if the API sent one. */
export const errorRequestId = (error: unknown): string | undefined =>
  isApiError(error) ? error.requestId : undefined;
