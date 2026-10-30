import { isApiError } from "@goshop/shared";
import type { Order, OrderStatus } from "@goshop/shared";
import { errorMessage } from "@/lib/error-message.ts";
import { ORDER_STATUS_OPTIONS, orderStatusLabel } from "./order-status.ts";

/** The four status changes the dashboard makes (the API's paths). */
export type OrderAction = "process" | "ship" | "complete" | "cancel";

/**
 * Which status each change starts from: the life cycle of ADR 0006 as
 * the API checks it (`order.CanTransition`), so the dashboard offers no
 * button the API would refuse anyway.
 *
 *   paid → processing → shipped → completed
 *   pending_payment, paid, processing → cancelled
 */
const ALLOWED_FROM: Record<OrderAction, readonly OrderStatus[]> = {
  process: ["paid"],
  ship: ["processing"],
  complete: ["shipped"],
  cancel: ["pending_payment", "paid", "processing"],
};

/** The order the buttons are shown in: the next step first, cancel last. */
const ACTION_ORDER: readonly OrderAction[] = [
  "process",
  "ship",
  "complete",
  "cancel",
];

/**
 * The changes that may be offered for `order` right now, in the order the
 * buttons appear. The one place that decides what the dashboard offers:
 * the detail page asks it, never the status directly.
 *
 * Today it reads the status only, so a seller sees "Batalkan" too and the
 * API answers 403 (cancel is admin-only since Bab 12; the page says so
 * plainly). Artikel 08 adds the role here (`can(role, "cancel")`), and
 * every caller follows. The API stays the judge either way: a button is a
 * convenience, the 403 or 409 is the truth.
 */
export const orderActions = (order: Pick<Order, "status">): OrderAction[] =>
  ACTION_ORDER.filter((action) => ALLOWED_FROM[action].includes(order.status));

/** Each change's button text, and what the notice says after it. */
export const ACTION_LABEL: Record<OrderAction, string> = {
  process: "Proses pesanan",
  ship: "Tandai dikirim",
  complete: "Tandai selesai",
  cancel: "Batalkan pesanan",
};

/** The sentence announced after a change succeeded. */
export const actionDoneMessage = (
  action: OrderAction,
  code: string,
): string => {
  switch (action) {
    case "process":
      return `Pesanan ${code} sedang diproses. Kemas barangnya, lalu kirim dengan nomor resi.`;
    case "ship":
      return `Pesanan ${code} ditandai dikirim. Pembeli dapat melacaknya dengan nomor resi.`;
    case "complete":
      return `Pesanan ${code} selesai.`;
    case "cancel":
      return `Pesanan ${code} dibatalkan. Stok dan voucher sudah dikembalikan.`;
  }
};

/**
 * The status an INVALID_TRANSITION says the order is in now
 * (`details.status`), when it is one the dashboard knows.
 */
const currentStatusOf = (error: unknown): OrderStatus | undefined => {
  if (!isApiError(error, "INVALID_TRANSITION")) return undefined;
  const status = error.details.status;
  return ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.value;
};

/**
 * How a failed change ends:
 *
 * - "conflict" (409 INVALID_TRANSITION): someone else moved the order
 *   first (another admin, the buyer, the payment expiry). The page
 *   refetches the order and says so; retrying would fail again.
 * - "forbidden" (403): this role may not make the change (a seller
 *   cancelling, since Bab 12). Final: the message says who can.
 * - "gone" (404): the order no longer exists for this account.
 * - "retry": the network or the server; the same action may succeed.
 */
export type ActionFailure = "conflict" | "forbidden" | "gone" | "retry";

export const actionFailure = (error: unknown): ActionFailure => {
  if (isApiError(error, "INVALID_TRANSITION")) return "conflict";
  if (isApiError(error, "FORBIDDEN")) return "forbidden";
  if (isApiError(error, "NOT_FOUND")) return "gone";
  return "retry";
};

/** A sentence for a failed change, in Indonesian, saying what to do next. */
export const actionErrorMessage = (
  action: OrderAction,
  error: unknown,
): string => {
  switch (actionFailure(error)) {
    case "conflict": {
      const now = currentStatusOf(error);
      return now === undefined
        ? "Pesanan ini sudah diubah orang lain. Data terbaru dimuat ulang; periksa statusnya sebelum melanjutkan."
        : `Pesanan ini sudah diubah orang lain: statusnya sekarang “${orderStatusLabel(now)}”. Data terbaru dimuat ulang; periksa sebelum melanjutkan.`;
    }
    case "forbidden":
      return action === "cancel"
        ? "Hanya admin yang boleh membatalkan pesanan. Minta admin toko untuk membatalkannya."
        : "Akun Anda tidak boleh mengubah pesanan ini.";
    case "gone":
      return "Pesanan ini tidak ditemukan lagi.";
    case "retry":
      return isApiError(
        error,
        "NETWORK_ERROR",
        "CLIENT_TIMEOUT",
        "TIMEOUT",
        "RATE_LIMITED",
      )
        ? errorMessage(error)
        : "Pesanan belum berubah karena kesalahan di server. Coba lagi.";
  }
};
