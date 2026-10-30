// GET /v1/admin/reports/sales (Bab 12 artikel 07).
import { http, HttpResponse } from "msw";
import type { ErrorBody, SalesReport, SalesReportDetail } from "@goshop/shared";
import type { Answer } from "./answers.ts";
import { apiUrl } from "./http.ts";

export const salesReportResponse = (report: SalesReport) =>
  HttpResponse.json<SalesReportDetail>({ data: report });

/** `answer` per request (it can read from, to and group), or one report. */
export const salesReportHandler = (answer: Answer | SalesReport) =>
  http.get<never, never, SalesReportDetail | ErrorBody>(
    apiUrl("/v1/admin/reports/sales"),
    ({ request }) =>
      typeof answer === "function"
        ? answer(request)
        : salesReportResponse(answer),
  );
