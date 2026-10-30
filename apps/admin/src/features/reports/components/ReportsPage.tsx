import { memo, useId, useMemo, useState } from "react";
import type { SalesReport } from "@goshop/shared";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { Skeleton } from "@/components/ui/Skeleton.tsx";
import { EmptyState, ErrorState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { cn } from "@/lib/utils.ts";
import { useReportParams } from "../hooks/useReportParams.ts";
import { useSalesReport } from "../hooks/useSalesReport.ts";
import {
  chartSummary,
  periodWord,
  reportRangeLabel,
} from "../report-summary.ts";
import { toChartRows } from "../chart-rows.ts";
import { PeriodChart } from "./PeriodChart.tsx";
import { ReportControls } from "./ReportControls.tsx";
import { SalesDataTable } from "./SalesDataTable.tsx";
import { SalesSummary } from "./SalesSummary.tsx";
import { TopProductsTable } from "./TopProductsTable.tsx";

/**
 * /laporan: the sales report. Revenue and orders per day, week or month
 * for a range of days, the range's totals, and the five best sellers,
 * from GET /v1/admin/reports/sales.
 *
 * Like the product table, the URL holds the state (useReportParams), the
 * state is the query key (useSalesReport), and the page only renders the
 * answer. This page is a lazy route (features/reports/lazy.ts): Recharts
 * is downloaded the first time someone opens it.
 */
export function ReportsPage() {
  useDocumentTitle("Laporan — GoShop Admin");
  const { params, update } = useReportParams();
  const { query: resolved, report } = useSalesReport(params);
  const { data } = report;
  const busy = report.isPlaceholderData;

  return (
    <>
      <PageHeader
        title="Laporan"
        description="Pendapatan dan jumlah pesanan per periode, dari pesanan yang sudah dibayar dan tidak dibatalkan."
      />
      <ReportControls params={params} resolved={resolved} onChange={update} />

      {/* One live line: what is on screen, or that the next is on its way. */}
      <p role="status" className="mb-4 text-sm text-muted-foreground">
        {report.isPending || busy
          ? "Memuat laporan…"
          : data !== undefined
            ? `${reportRangeLabel(data)}, per ${periodWord(data)}. Tanggal menurut WIB.`
            : ""}
      </p>

      {report.isPending && <ReportSkeleton />}

      {report.isError && (
        <ErrorState
          error={report.error}
          onRetry={() => {
            void report.refetch();
          }}
        />
      )}

      {data !== undefined && (
        <div
          aria-busy={busy}
          className={cn("grid gap-6 transition-opacity", busy && "opacity-60")}
        >
          {data.totals.order_count === 0 ? (
            <EmptyState>
              Belum ada penjualan pada {reportRangeLabel(data)}. Pilih rentang
              lain, atau tunggu pesanan pertama dibayar.
            </EmptyState>
          ) : (
            <ReportBody report={data} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * The report with sales: tiles, two charts, the data table, the top 5.
 *
 * Memoised (artikel 14): it depends on `report` alone, and the profiler
 * showed a range change re-rendering it, both charts and the data table
 * twice with the old report (once for the control, once when the URL
 * arrived), each time followed by Recharts' own store updates: ten
 * commits and some 4,200 components that changed nothing on screen. With
 * `memo` it renders when a new report arrives, and when its own
 * "Tampilkan kumulatif" changes.
 */
const ReportBody = memo(function ReportBody({
  report,
}: {
  report: SalesReport;
}) {
  const ids = {
    revenue: useId(),
    revenueNote: useId(),
    orders: useId(),
    ordersNote: useId(),
    top: useId(),
    mode: useId(),
  };
  const [cumulative, setCumulative] = useState(false);
  const rows = useMemo(() => toChartRows(report), [report]);
  const word = periodWord(report);
  const revenueTitle = cumulative
    ? "Pendapatan kumulatif"
    : `Pendapatan per ${word}`;
  const ordersTitle = `Pesanan per ${word}`;

  return (
    <>
      <SalesSummary report={report} />

      <Card as="section" labelledBy={ids.revenue} className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={ids.revenue}>{revenueTitle}</h2>
            <p id={ids.revenueNote} className="text-sm text-muted-foreground">
              {cumulative
                ? "Jumlah pendapatan dari awal rentang sampai tiap periode."
                : chartSummary(report, "revenue")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={ids.mode}
              type="checkbox"
              checked={cumulative}
              onChange={(event) => {
                setCumulative(event.target.checked);
              }}
              className="size-4 accent-primary"
            />
            <label htmlFor={ids.mode} className="text-sm font-medium">
              Tampilkan kumulatif
            </label>
          </div>
        </div>
        <PeriodChart
          report={report}
          rows={rows}
          measure={cumulative ? "cumulative" : "revenue"}
          label={`${revenueTitle}, ${reportRangeLabel(report)}`}
          describedBy={ids.revenueNote}
        />
      </Card>

      <Card as="section" labelledBy={ids.orders} className="grid gap-3">
        <div>
          <h2 id={ids.orders}>{ordersTitle}</h2>
          <p id={ids.ordersNote} className="text-sm text-muted-foreground">
            {chartSummary(report, "orders")}
          </p>
        </div>
        <PeriodChart
          report={report}
          rows={rows}
          measure="orders"
          label={`${ordersTitle}, ${reportRangeLabel(report)}`}
          describedBy={ids.ordersNote}
        />
      </Card>

      <SalesDataTable report={report} />

      <TopProductsTable report={report} headingId={ids.top} />
    </>
  );
});

/** The first load: grey blocks in the report's shape. */
function ReportSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-80" />
    </div>
  );
}
