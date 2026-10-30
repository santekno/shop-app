import type {
  Courier,
  OrderCancelReason,
  OrderStatus,
  PaymentStatus,
} from "@goshop/shared";

/**
 * The order statuses in the order of their life cycle (ADR 0006), each
 * with the word in the URL (Indonesian, like the paths: /pesanan?status=
 * dikirim) and the label a seller reads, on the tabs and on the badge.
 * `satisfies` checks every `value` against the generated type.
 */
export const ORDER_STATUS_OPTIONS = [
  { value: "pending_payment", param: "menunggu-bayar", label: "Belum dibayar" },
  { value: "paid", param: "dibayar", label: "Dibayar" },
  { value: "processing", param: "diproses", label: "Diproses" },
  { value: "shipped", param: "dikirim", label: "Dikirim" },
  { value: "completed", param: "selesai", label: "Selesai" },
  { value: "cancelled", param: "dibatalkan", label: "Dibatalkan" },
] as const satisfies readonly {
  value: OrderStatus;
  param: string;
  label: string;
}[];

/** The queue a seller opens /pesanan on: the paid orders, to pack. */
export const DEFAULT_QUEUE_STATUS: OrderStatus = "paid";

/** The query-string name of the queue's status. */
export const STATUS_PARAM = "status";

/** The label of a status, as the tabs and the badge show it. */
export const orderStatusLabel = (status: OrderStatus): string =>
  ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
  status;

/**
 * The queue's status from the URL: `?status=dikirim` is "shipped". No
 * parameter, or a word the dashboard does not know (a typo, an old
 * link), is the default queue rather than an error page.
 */
export const readQueueStatus = (searchParams: URLSearchParams): OrderStatus =>
  ORDER_STATUS_OPTIONS.find(
    (option) => option.param === searchParams.get(STATUS_PARAM),
  )?.value ?? DEFAULT_QUEUE_STATUS;

/**
 * The link to one status's queue. The default queue is plain /pesanan, so
 * the sidebar's link and the "Dibayar" tab are the same address.
 */
export const queueHref = (status: OrderStatus): string => {
  if (status === DEFAULT_QUEUE_STATUS) return "/pesanan";
  const param = ORDER_STATUS_OPTIONS.find(
    (option) => option.value === status,
  )?.param;
  return param === undefined ? "/pesanan" : `/pesanan?${STATUS_PARAM}=${param}`;
};

/** What a status means for whoever packs the orders: the queue's subtitle. */
export const QUEUE_HINT: Record<OrderStatus, string> = {
  pending_payment:
    "Pesanan yang menunggu pembeli membayar. Belum ada yang perlu dikemas.",
  paid: "Pesanan yang sudah dibayar dan siap dikemas, yang terbaru di atas. Yang paling lama menunggu ada di bawah.",
  processing:
    "Pesanan yang sedang dikemas. Kirim dengan nomor resi setelah diserahkan ke kurir.",
  shipped: "Pesanan yang sudah diserahkan ke kurir.",
  completed: "Pesanan yang sudah diterima pembeli.",
  cancelled: "Pesanan yang dibatalkan; stok dan voucher sudah dikembalikan.",
};

/** Why an order was cancelled, as the shop reads it. */
const CANCEL_REASON_LABEL: Record<NonNullable<OrderCancelReason>, string> = {
  payment_expired: "waktu pembayaran habis",
  buyer_cancelled: "dibatalkan pembeli",
  seller_cancelled: "dibatalkan toko",
};

/** "Dibatalkan (waktu pembayaran habis)", or the plain label. */
export const orderStatusText = (
  status: OrderStatus,
  cancelReason: OrderCancelReason,
): string =>
  status === "cancelled" && cancelReason !== null
    ? `${orderStatusLabel(status)} (${CANCEL_REASON_LABEL[cancelReason]})`
    : orderStatusLabel(status);

/** The couriers by their brand names, as on the parcel. */
export const COURIER_LABEL: Record<Courier, string> = {
  jne: "JNE",
  jnt: "J&T Express",
  sicepat: "SiCepat",
};

/** "JNE REG": the courier and the service the buyer chose. */
export const courierText = (courier: Courier, service: string): string =>
  `${COURIER_LABEL[courier]} ${service.toUpperCase()}`.trim();

/** The newest payment's status, as the shop reads it. */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Menunggu pembayaran",
  challenge: "Diperiksa Midtrans",
  paid: "Lunas",
  denied: "Ditolak",
  cancelled: "Dibatalkan",
  failed: "Gagal",
  expired: "Kedaluwarsa",
  refunded: "Dikembalikan",
  partially_refunded: "Dikembalikan sebagian",
};
