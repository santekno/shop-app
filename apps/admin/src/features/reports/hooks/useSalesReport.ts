import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-context.ts";
import { salesReportQuery } from "../api/queries.ts";
import { jakartaToday, toSalesReportQuery } from "../report-params.ts";
import type { ReportParams } from "../report-params.ts";

/**
 * The sales report that `params` asks for, fetched as the logged-in user,
 * with the two dates it covers (a preset resolved against today in
 * Jakarta, the API's "today"). The previous report stays as placeholder
 * data while the next one loads: `isPlaceholderData` is true then.
 */
export const useSalesReport = (params: ReportParams) => {
  const { authApi } = useSession();
  const query = toSalesReportQuery(params, jakartaToday());
  return { query, report: useQuery(salesReportQuery(authApi, query)) };
};
