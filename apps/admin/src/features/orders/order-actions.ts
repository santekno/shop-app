import { isApiError } from "@goshop/shared";
import type { Order, OrderStatus } from "@goshop/shared";
import { can } from "@/features/auth/permissions.ts";
import type { Permission } from "@/features/auth/permissions.ts";
import type { Role } from "@/features/auth/roles.ts";
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
 * Who may make each change (permissions.ts, which mirrors the API): a
 * seller moves orders on, only an admin cancels one (Bab 12).
 */
const ACTION_PERMISSION: Record<OrderAction, Permission> = {
  process: "order:fulfil",
  ship: "order:fulfil",
  complete: "order:fulfil",
  cancel: "order:cancel",
};

/** The changes the life cycle allows from `order`'s status, by anyone. */
const allowedByStatus = (order: Pick<Order, "status">): OrderAction[] =>
  ACTION_ORDER.filter((action) => ALLOWED_FROM[action].includes(order.status));

/**
 * The changes that may be offered for `order` to `role` right now, in the
 * order the buttons appear: the life cycle allows it from the order's
 * status, and the role may make it (artikel 08). The one place that
 * decides what the dashboard offers: the detail page asks it, never the
 * status or the role directly, so a seller sees no "Batalkan pesanan"
 * anywhere this function is asked.
 *
 * The API stays the judge: a button is a convenience, the 403 or 409 is
 * the truth.
 */
export const orderActions = (
  order: Pick<Order, "status">,
  role: Role,
): OrderAction[] =>
  allowedByStatus(order).filter((action) =>
    can(role, ACTION_PERMISSION[action]),
  );

/**
 * The changes the order's status allows but `role` may not make: what an
 * admin would be offered and this seller is not. The page explains them
 * instead of leaving the seller to wonder where "Batalkan" went; for an
 * order nobody can cancel any more (shipped, completed) there is nothing
 * to explain.
 */
export const withheldOrderActions = (
  order: Pick<Order, "status">,
  role: Role,
): OrderAction[] =>
  allowedByStatus(order).filter(
    (action) => !can(role, ACTION_PERMISSION[action]),
  );

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
 *   cancelling, since Bab 12). Final: the message says who can. The
 *   dashboard offers no change the role may not make, so a 403 means the
 *   role changed under the page (or permissions.ts is older than the
 *   API). The session has been refreshed by then (auth-client.ts), and
 *   the page already shows the buttons of the role the API now knows.
 * - "gone" (404): the order no longer exists for this account.
 * - "uncertain" (CLIENT_TIMEOUT): the request went out and no answer came
 *   in time. The API may have made the change anyway, and sending it
 *   again would then be refused as a conflict ("someone else changed
 *   it", which would be false). The page refetches the order instead, and
 *   the message says to check its status before trying again.
 * - "retry": the network or the server; the same action may succeed.
 */
export type ActionFailure =
  "conflict" | "forbidden" | "gone" | "uncertain" | "retry";

export const actionFailure = (error: unknown): ActionFailure => {
  if (isApiError(error, "INVALID_TRANSITION")) return "conflict";
  if (isApiError(error, "FORBIDDEN")) return "forbidden";
  if (isApiError(error, "NOT_FOUND")) return "gone";
  if (isApiError(error, "CLIENT_TIMEOUT")) return "uncertain";
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
    case "uncertain":
      return "Server tidak menjawab tepat waktu, jadi belum pasti perubahan ini tersimpan. Data terbaru dimuat ulang; periksa statusnya, lalu ulangi hanya jika statusnya belum berubah.";
    case "retry":
      return isApiError(error, "NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED")
        ? errorMessage(error)
        : "Pesanan belum berubah karena kesalahan di server. Coba lagi.";
  }
};
