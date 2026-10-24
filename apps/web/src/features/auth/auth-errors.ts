import { isApiError } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";

/** A sentence for a failed login or registration, above the form. */
export const authErrorMessage = (error: unknown): string => {
  if (isApiError(error, "NETWORK_ERROR", "CLIENT_TIMEOUT", "TIMEOUT")) {
    return errorMessage(error);
  }
  if (isApiError(error, "RATE_LIMITED")) return errorMessage(error);
  return "Permintaan tidak berhasil. Periksa isian Anda, lalu coba lagi.";
};
