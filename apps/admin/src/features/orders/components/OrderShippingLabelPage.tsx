import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router";
import { isApiError } from "@goshop/shared";
import type { Order } from "@goshop/shared";
import { MAIN_ID, focusPageHeading } from "@/app/useRouteFocus.ts";
import { Button } from "@/components/ui/Button.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { formatDateTime } from "@/lib/format-date.ts";
import { useAdminOrder } from "../hooks/useAdminOrder.ts";
import { COURIER_LABEL, orderStatusLabel } from "../order-status.ts";
import { OrderAddress } from "./OrderAddress.tsx";

/** The sender on every label: the shop. */
const SENDER = "GoShop";

/**
 * /pesanan/:orderId/resi: the order on paper, to stick on the parcel and
 * to pack it by. Two parts on one page:
 *
 * 1. the shipping label: the courier and service, the tracking number
 *    (resi), the order code, the recipient with phone and address, the
 *    sender, the weight;
 * 2. the packing slip: every line with SKU and quantity, to check the
 *    box against. No prices: the slip travels inside the parcel, and the
 *    recipient may not be the buyer (a gift).
 *
 * Outside the dashboard layout (no sidebar, no header, no breadcrumb), so
 * the page is the paper, on screen and in print. Only the toolbar ("Kembali
 * ke pesanan", "Cetak") is screen-only (`print:hidden`). "Cetak" calls
 * window.print(): the browser's own dialog, where the seller picks the
 * printer, the paper and "Save as PDF". Ctrl+P does the same.
 *
 * The page prints in black on white whatever the screen's theme
 * (index.css, @media print), and an order that must not leave the shop
 * (cancelled, not paid yet) says so on the paper too.
 */
export function OrderShippingLabelPage() {
  const { orderId = "" } = useParams();
  const query = useAdminOrder(orderId);
  const order = query.data;
  useDocumentTitle(
    `${order === undefined ? "Resi" : `Resi ${order.code}`} — GoShop Admin`,
  );

  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className="mx-auto grid max-w-3xl gap-4 p-4 focus:outline-none sm:p-8 print:max-w-none print:p-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link to={`/pesanan/${orderId}`}>
            <ArrowLeft aria-hidden="true" />
            Kembali ke pesanan
          </Link>
        </Button>
        <Button
          disabled={order === undefined}
          onClick={() => {
            window.print();
          }}
        >
          <Printer aria-hidden="true" />
          Cetak
        </Button>
      </div>

      <h1 tabIndex={-1} className="text-heading print:text-base">
        Resi pengiriman{order === undefined ? "" : ` ${order.code}`}
      </h1>

      {query.isPending && <LoadingState>Memuat pesanan…</LoadingState>}

      {query.isError &&
        order === undefined &&
        (isApiError(query.error, "NOT_FOUND") ? (
          <EmptyState>
            Pesanan ini tidak ditemukan. Mungkin alamatnya salah ketik.
          </EmptyState>
        ) : (
          <ErrorState
            error={query.error}
            onRetry={() => {
              focusPageHeading();
              void query.refetch();
            }}
          />
        ))}

      {order !== undefined && <ShippingLabel order={order} />}
    </main>
  );
}

/** Why this order must not be sent, or undefined when it may be. */
const holdReason = (order: Order): string | undefined => {
  if (order.status === "cancelled") {
    return "Pesanan ini dibatalkan. Jangan dikirim.";
  }
  if (order.status === "pending_payment") {
    return "Pesanan ini belum dibayar. Jangan dikirim sebelum lunas.";
  }
  return undefined;
};

function ShippingLabel({ order }: { order: Order }) {
  const { shipping } = order;
  const hold = holdReason(order);
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      {hold !== undefined && (
        <p
          role="alert"
          className="rounded-md border-2 border-destructive p-3 font-semibold text-destructive"
        >
          {hold}
        </p>
      )}

      <section
        aria-label="Label pengiriman"
        className="grid gap-4 rounded-lg border-2 border-foreground p-4 break-inside-avoid"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-foreground pb-3">
          <div className="grid">
            <span className="text-sm">Kurir</span>
            <span className="text-2xl font-bold">
              {COURIER_LABEL[shipping.courier]} {shipping.service.toUpperCase()}
            </span>
          </div>
          <div className="grid text-right">
            <span className="text-sm">Nomor resi</span>
            <span className="font-mono text-2xl font-bold break-all">
              {shipping.tracking_number ?? "—"}
            </span>
          </div>
        </div>

        {shipping.tracking_number === null && hold === undefined && (
          <p className="text-sm text-muted-foreground">
            Nomor resi belum diisi: pesanan ini belum ditandai dikirim. Label
            tetap dapat dicetak; nomor resi dari kurir ditulis di sini.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          <div className="grid gap-1">
            <span className="text-sm">Penerima</span>
            <OrderAddress address={shipping.address} className="text-lg" />
          </div>
          <div className="grid content-start gap-1">
            <span className="text-sm">Pengirim</span>
            <span className="font-semibold">{SENDER}</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t-2 border-foreground pt-3 sm:grid-cols-4 print:grid-cols-4">
          <div>
            <dt className="text-sm">Nomor pesanan</dt>
            <dd className="font-mono font-semibold">{order.code}</dd>
          </div>
          <div>
            <dt className="text-sm">Tanggal pesan</dt>
            <dd>{formatDateTime(order.created_at)}</dd>
          </div>
          <div>
            <dt className="text-sm">Berat</dt>
            <dd>
              {(order.totals.weight_grams / 1000).toLocaleString("id-ID")} kg
            </dd>
          </div>
          <div>
            <dt className="text-sm">Status</dt>
            <dd>{orderStatusLabel(order.status)}</dd>
          </div>
        </dl>
      </section>

      <div
        aria-hidden="true"
        className="border-t-2 border-dashed border-muted-foreground print:border-foreground"
      />

      <section aria-labelledby="slip-title" className="grid gap-3">
        <h2 id="slip-title" className="text-base">
          Daftar barang — {order.code}
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground text-left">
              <th scope="col" className="py-1 pr-2">
                Produk
              </th>
              <th scope="col" className="py-1 pr-2">
                SKU
              </th>
              <th scope="col" className="py-1 text-right">
                Jumlah
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-border">
                <td className="py-1 pr-2">
                  {item.product_name}
                  <span className="text-muted-foreground print:text-foreground">
                    {" "}
                    — {item.variant_name}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono">{item.sku}</td>
                <td className="py-1 text-right">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="py-1 text-left">
                Jumlah barang
              </th>
              <td className="py-1 text-right font-semibold">{units}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </>
  );
}
