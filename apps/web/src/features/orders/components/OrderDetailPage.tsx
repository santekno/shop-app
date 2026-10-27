import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { formatRupiah, isApiError } from "@goshop/shared";
import type { Order } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { Section } from "@/components/ui/Section.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { orderQuery } from "../api/queries.ts";
import { formatDateTime } from "../format.ts";
import {
  canStartPayment,
  orderStatusText,
  payButtonText,
} from "../order-status.ts";
import { ORDERS_PATH, paymentPath } from "../paths.ts";
import { OrderStatusBadge } from "./OrderStatusBadge.tsx";
import { PayButton } from "./PayButton.tsx";

/** The courier codes of the contract, as a buyer knows them. */
const COURIER_NAME: Record<Order["shipping"]["courier"], string> = {
  jne: "JNE",
  jnt: "J&T Express",
  sicepat: "SiCepat",
};

/** The moments of an order that have happened, oldest first. */
const timeline = (order: Order): [string, string][] => {
  const steps: [string, string | null][] = [
    ["Dibuat", order.created_at],
    ["Dibayar", order.paid_at],
    ["Dikirim", order.shipped_at],
    ["Selesai", order.completed_at],
    ["Dibatalkan", order.cancelled_at],
  ];
  return steps.filter((step): step is [string, string] => step[1] !== null);
};

/**
 * /pesanan/:id: one order (Bab 11 artikel 06), from GET /v1/orders/{id}.
 *
 * Everything shown is the order's own copy, made at checkout (ADR 0006):
 * the product and variant names, the unit prices, the voucher code and
 * the shipping address. A product renamed or repriced since, or an
 * address edited, does not change a past order, so this page never looks
 * the products up again.
 *
 * An unpaid order offers "Bayar sekarang" (the same PayButton as the
 * payment page) and a link to its payment page.
 */
export function OrderDetailPage() {
  useDocumentTitle("Detail pesanan — GoShop");
  const { id = "" } = useParams();
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const order = useQuery({
    ...orderQuery(authApi, userId, id),
    enabled: session !== null,
  });

  return (
    <div className="grid gap-4">
      <Card>
        <p className="mb-2">
          <Link to={ORDERS_PATH}>← Pesanan saya</Link>
        </p>
        <h1 tabIndex={-1}>Detail pesanan</h1>
        {(order.status === "pending" ||
          (order.status === "error" && order.isFetching)) && (
          <LoadingState>Memuat pesanan…</LoadingState>
        )}
        {order.status === "error" &&
          !order.isFetching &&
          (isApiError(order.error, "NOT_FOUND") ? (
            <p role="alert" className="mt-2">
              Pesanan ini tidak ditemukan.
            </p>
          ) : (
            <ErrorState
              error={order.error}
              onRetry={() => {
                void order.refetch();
              }}
            />
          ))}
        {order.status === "success" && (
          <div className="mt-3 grid gap-3">
            <p className="flex flex-wrap items-center gap-2">
              <strong>{order.data.code}</strong>
              <OrderStatusBadge status={order.data.status} />
            </p>
            {order.data.status === "cancelled" && (
              <p>{orderStatusText(order.data)}.</p>
            )}
            {order.data.status === "pending_payment" && (
              <>
                <p>
                  Bayar sebelum {formatDateTime(order.data.payment_expires_at)}.{" "}
                  <Link to={paymentPath(order.data.id)}>
                    Lihat status pembayaran
                  </Link>
                </p>
                {canStartPayment(order.data, order.dataUpdatedAt) && (
                  <PayButton order={order.data}>
                    {payButtonText(order.data)}
                  </PayButton>
                )}
              </>
            )}
          </div>
        )}
      </Card>
      {order.status === "success" && <OrderBody order={order.data} />}
    </div>
  );
}

/** The order's lines, totals, shipping and history. */
function OrderBody({ order }: { order: Order }) {
  const { totals, shipping } = order;
  return (
    <>
      <Section title="Barang">
        <ul className="grid gap-2" aria-label="Barang dalam pesanan">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span>
                {item.product_name}{" "}
                <span className="text-muted-foreground">
                  ({item.variant_name}) · {item.quantity} ×{" "}
                  {formatRupiah(item.unit_price)}
                </span>
              </span>
              <span className="tabular-nums">
                {formatRupiah(item.line_total)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-3">
          <dt>Subtotal</dt>
          <dd className="text-right tabular-nums">
            {formatRupiah(totals.subtotal)}
          </dd>
          {totals.discount.amount > 0 && (
            <>
              <dt>
                Diskon
                {order.voucher_code !== null &&
                  ` voucher ${order.voucher_code}`}
              </dt>
              <dd className="text-right tabular-nums">
                −{formatRupiah(totals.discount)}
              </dd>
            </>
          )}
          <dt>Ongkos kirim</dt>
          <dd className="text-right tabular-nums">
            {formatRupiah(totals.shipping_fee)}
          </dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">
            {formatRupiah(totals.total)}
          </dd>
        </dl>
      </Section>
      <Section title="Pengiriman">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Kurir</dt>
          <dd>
            {COURIER_NAME[shipping.courier]} {shipping.service}
          </dd>
          <dt className="text-muted-foreground">Nomor resi</dt>
          <dd>{shipping.tracking_number ?? "Belum dikirim"}</dd>
          <dt className="text-muted-foreground">Alamat</dt>
          <dd>
            {shipping.address.recipient_name} · {shipping.address.phone}
            <br />
            {shipping.address.street}, {shipping.address.city},{" "}
            {shipping.address.province} {shipping.address.postal_code}
          </dd>
        </dl>
      </Section>
      <Section title="Riwayat">
        <ol className="grid gap-1">
          {timeline(order).map(([label, at]) => (
            <li key={label} className="flex justify-between gap-4">
              <span>{label}</span>
              <time dateTime={at} className="text-muted-foreground">
                {formatDateTime(at)}
              </time>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
