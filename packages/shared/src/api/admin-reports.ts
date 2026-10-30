import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  SalesReport,
  SalesReportDetail,
  SalesReportQuery,
} from "./types.ts";

/**
 * GET /v1/admin/reports/sales: revenue, order count and average order
 * value per day, week or month, with a running total, and the top 5
 * products, for the orders paid in the range that were not cancelled
 * afterwards. Returns the report itself, not the `{ data }` envelope.
 *
 * `from` and `to` are Jakarta dates (`YYYY-MM-DD`, WIB), both included,
 * at most 366 days in all; left out, the API reports the 30 days up to
 * today in Jakarta. Every period of the range is in `series`, empty ones
 * included (revenue 0); weeks start on Monday, and the first week or
 * month may start before `from` (only the days in the range are counted).
 *
 * Staff only, so `api` must be a client that sends the access token (the
 * dashboard's `authApi`). Throws VALIDATION_FAILED for a date that is not
 * a calendar date, `to` before `from` or a range longer than 366 days,
 * UNAUTHORIZED, or FORBIDDEN for a buyer.
 *
 * @example
 *   const report = await getSalesReport(authApi, {
 *     from: "2026-10-01",
 *     to: "2026-10-31",
 *     group: "week",
 *   });
 *   report.totals.revenue; // { amount: 12450000, currency: "IDR" }
 */
export const getSalesReport = async (
  api: ApiClient,
  query: SalesReportQuery = {},
  { signal }: EndpointOptions = {},
): Promise<SalesReport> => {
  const body = await api.request<SalesReportDetail>("/v1/admin/reports/sales", {
    query,
    signal,
  });
  return body.data;
};
