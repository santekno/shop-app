import type { SalesReport } from "@goshop/shared";

/** One period as the charts read it: plain numbers, keyed by name. */
export interface ChartRow {
  period: string;
  revenue: number;
  orders: number;
  average: number;
  cumulative: number;
}

/** The report's series as chart rows (Money → whole rupiah). */
export const toChartRows = (report: SalesReport): ChartRow[] =>
  report.series.map((row) => ({
    period: row.period,
    revenue: row.revenue.amount,
    orders: row.order_count,
    average: row.average_order_value.amount,
    cumulative: row.cumulative_revenue.amount,
  }));
