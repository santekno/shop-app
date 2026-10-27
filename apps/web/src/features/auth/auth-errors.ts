import { isApiError } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";

/**
 * A sentence for a failed login or registration that belongs to no single
 * field: shown above the button (React Hook Form's `root` error).
 */
export const authErrorMessage = (error: unknown): string => {
  // Every reason (unknown email, wrong password, Google-only account)
  // is the same 401, so the message names neither field.
  if (isApiError(error, "INVALID_CREDENTIALS")) {
    return "Email atau kata sandi salah.";
  }
  if (isApiError(error, "NETWORK_ERROR", "CLIENT_TIMEOUT", "TIMEOUT")) {
    return errorMessage(error);
  }
  if (isApiError(error, "RATE_LIMITED")) return errorMessage(error);
  return "Permintaan tidak berhasil. Periksa isian Anda, lalu coba lagi.";
};
