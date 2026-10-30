import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import {
  formatCount,
  formatDateRange,
  formatPeriodLabel,
} from "./report-format.ts";
import { GROUP_OPTIONS } from "./report-params.ts";

/** "hari", "minggu" or "bulan": what one period of the report is. */
export const periodWord = (report: SalesReport): string =>
  GROUP_OPTIONS.find((option) => option.value === report.group)?.period ??
  "periode";

const rupiah = (amount: number) => formatRupiah({ amount, currency: "IDR" });

/**
 * What a chart shows, in one or two sentences, for a screen reader (the
 * chart's aria-describedby) and as the chart's visible note: the busiest
 * period and how many periods had no sale. The numbers of every period
 * are in the data table; this is the shape a sighted reader takes in at
 * a glance.
 *
 * @example
 *   chartSummary(report, "revenue");
 *   // "Tertinggi Rp 2.150.000 pada Senin, 12 Oktober 2026.
 *   //  3 dari 30 hari tanpa penjualan."
 */
export const chartSummary = (
  report: SalesReport,
  measure: "revenue" | "orders",
): string => {
  const value = (row: SalesReport["series"][number]) =>
    measure === "revenue" ? row.revenue.amount : row.order_count;
  const best = report.series.reduce<SalesReport["series"][number] | undefined>(
    (top, row) => (top === undefined || value(row) > value(top) ? row : top),
    undefined,
  );
  if (best === undefined || value(best) === 0) {
    return "Tidak ada penjualan pada rentang ini.";
  }
  const when = formatPeriodLabel(best.period, report.group, report);
  const peak =
    measure === "revenue"
      ? `Tertinggi ${rupiah(best.revenue.amount)} pada ${when}.`
      : `Terbanyak ${formatCount(best.order_count)} pesanan pada ${when}.`;
  const empty = report.series.filter((row) => row.order_count === 0).length;
  const word = periodWord(report);
  return empty === 0
    ? `${peak} Setiap ${word} ada penjualan.`
    : `${peak} ${formatCount(empty)} dari ${formatCount(report.series.length)} ${word} tanpa penjualan.`;
};

/** "1–30 Okt 2026", the report's range as a reader says it. */
export const reportRangeLabel = (report: SalesReport): string =>
  formatDateRange(report.from, report.to);
