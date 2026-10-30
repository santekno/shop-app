import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  formatCount,
  formatPeriodLabel,
  formatPeriodTick,
  formatRupiahCompact,
} from "../report-format.ts";
import type { ChartRow } from "../chart-rows.ts";

/** What a chart plots: revenue per period, its running total, or orders. */
export type ChartMeasure = "revenue" | "cumulative" | "orders";

interface PeriodChartProps {
  report: SalesReport;
  rows: ChartRow[];
  measure: ChartMeasure;
  /** The chart's accessible name, the same words as its visible heading. */
  label: string;
  /** The id of the sentence that summarises the chart for a screen reader. */
  describedBy: string;
}

/*
 * Colours come from the theme's tokens, as CSS variables: an SVG
 * presentation attribute such as fill="var(--primary)" is a CSS value,
 * so the chart follows dark mode with the rest of the page, with no
 * second palette and no re-render. One series per chart, one colour:
 * the heading names what it is, so no legend is needed.
 */
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const AXIS_LINE = { stroke: "var(--border)" };

/**
 * One measure of the report over its periods, drawn with Recharts: bars
 * for revenue or orders per period, an area for the running total (a sum
 * that only grows reads as a line, not as separate bars).
 *
 * The axis is compact ("Rp1,3 jt") and the tooltip exact ("Rp 1.250.000"),
 * with every number of that period. A chart is not accessible by itself:
 * the svg is one image to a screen reader (role="img", named by `label`,
 * described by a summary sentence), and every number is in the data table
 * under the charts. Recharts' keyboard layer stays on: Tab reaches the
 * chart, and the arrow keys move the tooltip from period to period.
 *
 * Only one axis, ever: revenue (millions) and orders (tens) on two scales
 * in one frame would make their crossing points meaningless, so they are
 * two charts.
 */
export function PeriodChart({
  report,
  rows,
  measure,
  label,
  describedBy,
}: PeriodChartProps) {
  const range = { from: report.from, to: report.to };
  const money = measure !== "orders";

  const xAxis = (
    <XAxis
      dataKey="period"
      tickFormatter={(period: string) =>
        formatPeriodTick(period, report.group, range)
      }
      tick={AXIS_TICK}
      axisLine={AXIS_LINE}
      tickLine={false}
      interval="preserveStartEnd"
      minTickGap={16}
    />
  );
  const yAxis = (
    <YAxis
      width="auto"
      tickFormatter={(value: number) =>
        money ? formatRupiahCompact(value) : formatCount(value)
      }
      allowDecimals={false}
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
    />
  );
  const grid = (
    <CartesianGrid
      vertical={false}
      stroke="var(--border)"
      strokeOpacity={0.7}
    />
  );
  const tooltip = (
    <Tooltip
      content={(props) => <PeriodTooltip {...props} report={report} />}
      cursor={
        measure === "cumulative"
          ? { stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }
          : { fill: "var(--muted)" }
      }
      isAnimationActive={false}
    />
  );
  const chartProps = {
    data: rows,
    responsive: true,
    // The chart's size is CSS: as wide as its card, 16 rem high.
    className: "h-64 w-full",
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
    role: "img",
    "aria-label": label,
    "aria-describedby": describedBy,
  };

  if (measure === "cumulative") {
    return (
      <AreaChart {...chartProps}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        <Area
          dataKey="cumulative"
          name="Pendapatan kumulatif"
          type="linear"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="var(--primary)"
          fillOpacity={0.15}
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
          dot={false}
        />
      </AreaChart>
    );
  }
  return (
    <BarChart {...chartProps}>
      {grid}
      {xAxis}
      {yAxis}
      {tooltip}
      <Bar
        dataKey={measure}
        name={measure === "orders" ? "Pesanan" : "Pendapatan"}
        fill="var(--primary)"
        radius={[4, 4, 0, 0]}
        maxBarSize={40}
      />
    </BarChart>
  );
}

/**
 * The tooltip: the period in full and its numbers, exact. Every chart
 * shows the same three facts, so moving between the charts never hides
 * one. Text uses the text tokens, never the bar's colour.
 */
function PeriodTooltip({
  active,
  payload,
  report,
}: TooltipContentProps & { report: SalesReport }) {
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!active || row === undefined) return null;
  const rupiah = (amount: number) => formatRupiah({ amount, currency: "IDR" });
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">
        {formatPeriodLabel(row.period, report.group, report)}
      </p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <dt className="text-muted-foreground">Pendapatan</dt>
        <dd className="text-right tabular-nums">{rupiah(row.revenue)}</dd>
        <dt className="text-muted-foreground">Pesanan</dt>
        <dd className="text-right tabular-nums">{formatCount(row.orders)}</dd>
        <dt className="text-muted-foreground">Rata-rata</dt>
        <dd className="text-right tabular-nums">{rupiah(row.average)}</dd>
        <dt className="text-muted-foreground">Kumulatif</dt>
        <dd className="text-right tabular-nums">{rupiah(row.cumulative)}</dd>
      </dl>
    </div>
  );
}
