import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import { formatCount } from "../report-format.ts";

/**
 * The range's totals as three tiles: revenue, orders, and the average
 * order value. A description list: each number is read with its name
 * ("Pendapatan, Rp 12.450.000"), not as a loose figure.
 */
export function SalesSummary({ report }: { report: SalesReport }) {
  const { totals } = report;
  const tiles = [
    { label: "Pendapatan", value: formatRupiah(totals.revenue) },
    { label: "Pesanan", value: formatCount(totals.order_count) },
    {
      label: "Rata-rata per pesanan",
      value: formatRupiah(totals.average_order_value),
    },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {tiles.map(({ label, value }) => (
        <div
          key={label}
          className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs"
        >
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
