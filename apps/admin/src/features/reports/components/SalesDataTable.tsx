import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { formatCount, formatPeriodLabel } from "../report-format.ts";
import { periodWord, reportRangeLabel } from "../report-summary.ts";

/**
 * Every number the charts draw, as a table: the charts' accessible
 * equivalent, and the place to read an exact figure. Behind a native
 * <details> disclosure ("Lihat data dalam tabel"): a year by day is 366
 * rows, too long to sit open under the charts, and <details> opens with
 * Enter or Space and tells a screen reader whether it is open, with no
 * script of ours.
 */
export function SalesDataTable({ report }: { report: SalesReport }) {
  const word = periodWord(report);
  return (
    <details className="group rounded-lg border border-border bg-card text-card-foreground shadow-xs">
      <summary className="cursor-pointer px-4 py-3 font-medium select-none">
        Lihat data dalam tabel ({formatCount(report.series.length)} {word})
      </summary>
      <div className="px-4 pb-4">
        <TableContainer aria-label={`Data penjualan per ${word}`}>
          <Table>
            <TableCaption className="sr-only">
              Pendapatan dan pesanan per {word}, {reportRangeLabel(report)}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
                <TableHead className="text-right">Pesanan</TableHead>
                <TableHead className="text-right">
                  Rata-rata per pesanan
                </TableHead>
                <TableHead className="text-right">Kumulatif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.series.map((row) => (
                <TableRow key={row.period}>
                  {/* A row header: a screen reader reads the period with
                      every number in its row. */}
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {formatPeriodLabel(row.period, report.group, report)}
                  </th>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(row.revenue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(row.order_count)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(row.average_order_value)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRupiah(row.cumulative_revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot className="border-t border-border font-medium">
              <TableRow>
                <th scope="row" className="px-3 py-2 text-left">
                  Total
                </th>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(report.totals.revenue)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(report.totals.order_count)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(report.totals.average_order_value)}
                </TableCell>
                {/* The running total of the last period is the total. */}
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(report.totals.revenue)}
                </TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </TableContainer>
      </div>
    </details>
  );
}
