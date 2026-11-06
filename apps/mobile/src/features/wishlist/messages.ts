// What a failed wishlist change means to the buyer, in Indonesian. The
// codes are the ones api/openapi.yaml documents for PUT and DELETE
// /v1/me/wishlist/{slug}.
import { isApiError } from "@goshop/shared";

/** Said when nobody is signed in; the API is not called at all. */
export const SIGN_IN_MESSAGE = "Masuk dulu untuk menyimpan wishlist";

/** The API's wishlist limit when its 409 does not say (details.max). */
export const DEFAULT_WISHLIST_MAX = 200;

/** Thrown by the request functions when there is no token to send. */
export class SignInRequiredError extends Error {
  constructor() {
    super(SIGN_IN_MESSAGE);
    this.name = "SignInRequiredError";
  }
}

/**
 * The sentence for a failed save or removal. The 409 reads the limit from
 * `details.max` (200 today), so the sentence follows the server if the
 * limit changes.
 */
export const wishlistErrorMessage = (error: unknown): string => {
  if (error instanceof SignInRequiredError) return SIGN_IN_MESSAGE;
  if (isApiError(error)) {
    if (error.code === "WISHLIST_LIMIT_REACHED") {
      const max =
        typeof error.details.max === "number"
          ? error.details.max
          : DEFAULT_WISHLIST_MAX;
      return `Wishlist penuh (maksimal ${max} produk). Hapus satu produk dulu.`;
    }
    if (error.status === 401) {
      return "Sesi Anda berakhir. Masuk lagi untuk mengubah wishlist.";
    }
    if (error.status === 403) return "Wishlist hanya untuk akun pembeli.";
    if (error.status === 404) return "Produk ini sudah tidak tersedia.";
  }
  return "Wishlist belum bisa diubah. Periksa koneksi Anda, lalu coba lagi.";
};
