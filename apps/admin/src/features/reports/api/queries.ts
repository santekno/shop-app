import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getSalesReport } from "@goshop/shared";
import type { ApiClient, SalesReportQuery } from "@goshop/shared";

/**
 * The query keys of the reports section:
 *
 *   ["admin", "reports"]                                every report
 *   ["admin", "reports", "sales", { from, to, group }]  one report
 *
 * The whole query is the key, so each range and grouping is its own
 * cache entry: going back from "per minggu" to "per hari" shows the
 * report already fetched at once.
 */
export const reportKeys = {
  all: ["admin", "reports"] as const,
  sales: (query: Required<SalesReportQuery>) =>
    [...reportKeys.all, "sales", query] as const,
};

/**
 * GET /v1/admin/reports/sales as query options, as the logged-in user
 * (`client` is the session's authApi). `placeholderData: keepPreviousData`
 * keeps the last report on screen while the next range loads, as the
 * product table keeps its last page: the charts dim instead of collapsing
 * into a skeleton and pushing the controls around.
 */
export const salesReportQuery = (
  client: ApiClient,
  query: Required<SalesReportQuery>,
) =>
  queryOptions({
    queryKey: reportKeys.sales(query),
    queryFn: ({ signal }) => getSalesReport(client, query, { signal }),
    placeholderData: keepPreviousData,
  });
