import { useId } from "react";
import { formatRupiah } from "@goshop/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { Skeleton } from "@/components/ui/Skeleton.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { salesReportQuery } from "../api/queries.ts";
import { formatCount } from "../report-format.ts";
import { jakartaToday, toSalesReportQuery } from "../report-params.ts";
import { reportRangeLabel } from "../report-summary.ts";

/**
 * The overview page's sales tile: revenue and orders of the last 7 days,
 * and a link to the full report. It asks the API for exactly the query
 * /laporan?rentang=7&kelompok=minggu would, so following the link shows
 * that report from the cache at once.
 *
 * It lives in the main bundle (the overview is the first page after a
 * login), so it imports no chart code: numbers only. Recharts stays in
 * the report page's own chunk.
 */
export function RecentSalesTile() {
  const headingId = useId();
  const { authApi } = useSession();
  const report = useQuery(
    salesReportQuery(
      authApi,
      toSalesReportQuery(
        { range: { kind: "preset", days: 7 }, group: "week" },
        jakartaToday(),
      ),
    ),
  );
  const { data } = report;

  return (
    <Card as="section" labelledBy={headingId} className="mb-6 grid gap-2">
      <h2 id={headingId} className="text-base">
        Penjualan 7 hari terakhir
      </h2>
      {report.isPending && (
        <div role="status" className="grid gap-2">
          <span className="sr-only">Memuat penjualan…</span>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}
      {report.isError && (
        <p className="text-sm text-muted-foreground">
          Penjualan tidak dapat dimuat sekarang.{" "}
          <Link to="/laporan?rentang=7">Buka laporan</Link>
        </p>
      )}
      {data !== undefined && (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {formatRupiah(data.totals.revenue)}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCount(data.totals.order_count)} pesanan,{" "}
            {reportRangeLabel(data)} (WIB).{" "}
            <Link to="/laporan?rentang=7&kelompok=minggu">Lihat laporan</Link>
          </p>
        </>
      )}
    </Card>
  );
}
