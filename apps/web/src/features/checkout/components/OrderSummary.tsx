import { formatRupiah } from "@goshop/shared";
import type { CheckoutPreview } from "@goshop/shared";

interface OrderSummaryProps {
  preview: CheckoutPreview;
  /** A newer preview is on its way; the numbers shown are the last ones. */
  updating: boolean;
}

/**
 * What the order will cost (Bab 11 artikel 03), exactly as
 * POST /v1/checkout/preview computed it.
 *
 * There is no arithmetic on this page. The subtotal, the discount, the
 * shipping fee and the total are the API's `totals`, in whole rupiah,
 * with a percent discount rounded once on the server (ADR 0006). A total
 * added up here could differ from the one charged by a rupiah, or by a
 * shipping fee the courier has changed since the quote; showing the API's
 * numbers means the buyer sees what checkout will charge.
 *
 * While a new preview loads (another courier, a voucher), the last
 * numbers stay on screen, dimmed, marked `aria-busy`, so the summary does
 * not jump to "loading" and back on every choice.
 */
export function OrderSummary({ preview, updating }: OrderSummaryProps) {
  const { totals, shipping, voucher } = preview;
  return (
    <div
      className={updating ? "grid gap-3 opacity-60" : "grid gap-3"}
      aria-busy={updating}
    >
      <ul className="grid gap-2" aria-label="Barang yang dipesan">
        {preview.lines.map((line) => (
          <li key={line.variant_id} className="flex justify-between gap-4">
            <span>
              {line.product_name}{" "}
              <span className="text-muted-foreground">
                ({line.variant_name}) × {line.quantity}
              </span>
            </span>
            <span className="tabular-nums">
              {formatRupiah(line.line_total)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="order-totals grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-3">
        <dt>Subtotal</dt>
        <dd className="text-right tabular-nums">
          {formatRupiah(totals.subtotal)}
        </dd>
        {voucher !== null && voucher !== undefined && (
          <>
            <dt>Diskon voucher {voucher.code}</dt>
            <dd className="text-right tabular-nums">
              −{formatRupiah(totals.discount)}
            </dd>
          </>
        )}
        <dt>
          Ongkos kirim
          {shipping !== null && shipping !== undefined && (
            <span className="text-muted-foreground">
              {" "}
              ({shipping.courier_name} {shipping.service_name})
            </span>
          )}
        </dt>
        <dd className="text-right tabular-nums">
          {shipping === null || shipping === undefined
            ? "Pilih kurir"
            : formatRupiah(totals.shipping_fee)}
        </dd>
        <dt className="font-semibold">Total</dt>
        <dd className="order-total text-right font-semibold tabular-nums">
          {formatRupiah(totals.total)}
        </dd>
      </dl>
    </div>
  );
}
