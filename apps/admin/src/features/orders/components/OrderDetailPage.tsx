import { useId } from "react";
import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Link, useParams } from "react-router";
import { isApiError } from "@goshop/shared";
import type { Order } from "@goshop/shared";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { formatDateTime } from "@/lib/format-date.ts";
import { useAdminOrder } from "../hooks/useAdminOrder.ts";
import {
  PAYMENT_STATUS_LABEL,
  courierText,
  orderStatusLabel,
  queueHref,
} from "../order-status.ts";
import { OrderActionsPanel } from "./OrderActionsPanel.tsx";
import { OrderAddress } from "./OrderAddress.tsx";
import { OrderItemsTable } from "./OrderItemsTable.tsx";
import { OrderStatusBadge } from "./OrderStatusBadge.tsx";
import { OrderTimeline } from "./OrderTimeline.tsx";

/**
 * /pesanan/:orderId: one order, everything the shop needs to fulfil it
 * (GET /v1/admin/orders/{id}): what to change next, what was bought, where
 * it goes and with which courier, how it was paid, and what happened so
 * far.
 *
 * The page reads the order query and nothing else; every change
 * (OrderActionsPanel) puts the API's answer into that query, so the
 * badge, the timeline and the buttons all follow the same fact.
 */
export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const query = useAdminOrder(orderId);
  const order = query.data;
  useDocumentTitle(
    `${order === undefined ? "Detail pesanan" : `Pesanan ${order.code}`} — GoShop Admin`,
  );

  return (
    <>
      <PageHeader
        title="Detail pesanan"
        description={
          order === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-foreground">{order.code}</span>
              <OrderStatusBadge
                status={order.status}
                cancelReason={order.cancel_reason}
              />
            </span>
          )
        }
        actions={
          order === undefined ? undefined : (
            <Button asChild variant="outline">
              <Link to={`/pesanan/${order.id}/resi`}>
                <Printer aria-hidden="true" />
                Cetak resi
              </Link>
            </Button>
          )
        }
      />

      {query.isPending && <LoadingState>Memuat pesanan…</LoadingState>}

      {query.isError &&
        order === undefined &&
        (isApiError(query.error, "NOT_FOUND") ? (
          <div className="grid justify-items-start gap-2">
            <EmptyState>
              Pesanan ini tidak ditemukan. Mungkin alamatnya salah ketik.
            </EmptyState>
            <Button asChild variant="outline" size="sm">
              <Link to="/pesanan">Kembali ke daftar pesanan</Link>
            </Button>
          </div>
        ) : (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ))}

      {order !== undefined && <OrderDetail order={order} />}
    </>
  );
}

/** The loaded order, in two columns from `lg`, one below that. */
function OrderDetail({ order }: { order: Order }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-4">
        <OrderActionsPanel order={order} />
        <Section title="Barang">
          <OrderItemsTable order={order} />
        </Section>
      </div>
      <div className="grid gap-4">
        <Section title="Pengiriman">
          <dl className="grid gap-3">
            <Field label="Kurir">
              {courierText(order.shipping.courier, order.shipping.service)}
            </Field>
            <Field label="Nomor resi">
              {order.shipping.tracking_number === null ? (
                <span className="text-muted-foreground">
                  Belum ada; diisi saat pesanan dikirim.
                </span>
              ) : (
                <span className="font-mono">
                  {order.shipping.tracking_number}
                </span>
              )}
            </Field>
            <Field label="Alamat">
              <OrderAddress address={order.shipping.address} />
            </Field>
          </dl>
        </Section>
        <Section title="Pembayaran">
          <dl className="grid gap-3">
            <Field label="Status pembayaran">
              {order.latest_payment === null
                ? "Pembeli belum mulai membayar"
                : PAYMENT_STATUS_LABEL[order.latest_payment.status]}
            </Field>
            {order.paid_at !== null ? (
              <Field label="Dibayar">{formatDateTime(order.paid_at)}</Field>
            ) : (
              order.status === "pending_payment" && (
                <Field label="Batas bayar">
                  {formatDateTime(order.payment_expires_at)}
                </Field>
              )
            )}
          </dl>
        </Section>
        <Section title="Riwayat">
          <OrderTimeline order={order} />
        </Section>
        <p className="text-sm">
          <Link to={queueHref(order.status)}>
            Lihat antrean “{orderStatusLabel(order.status)}”
          </Link>
        </p>
      </div>
    </div>
  );
}

/** A titled card: its <h2> names the section for a screen reader. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card as="section" labelledBy={id}>
      <h2 id={id} className="mb-3">
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** One term and its value in a description list. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
