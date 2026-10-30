import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { api } from "@/lib/api.ts";
import { salesReport } from "@/test/fixtures.ts";
import { recordRequests } from "@/test/msw/http.ts";
import { salesReportHandler } from "@/test/msw/reports.ts";
import { server } from "@/test/msw/server.ts";
import { reportKeys, salesReportQuery } from "./queries.ts";

const query = { from: "2026-10-01", to: "2026-10-31", group: "week" } as const;

describe("reportKeys", () => {
  it("keys each report by its whole query, under one prefix", () => {
    expect(reportKeys.all).toEqual(["admin", "reports"]);
    expect(reportKeys.sales(query)).toEqual([
      "admin",
      "reports",
      "sales",
      query,
    ]);
  });
});

describe("salesReportQuery", () => {
  it("fetches the report for exactly that query", async () => {
    const sent = recordRequests();
    server.use(salesReportHandler(salesReport()));
    const options = salesReportQuery(api, query);

    await expect(new QueryClient().query(options)).resolves.toEqual(
      salesReport(),
    );

    expect(options.queryKey).toEqual(reportKeys.sales(query));
    expect(Object.fromEntries(sent[0]?.url.searchParams ?? [])).toEqual(query);
  });

  it("keeps the previous report on screen while the next loads", () => {
    expect(salesReportQuery(api, query).placeholderData).toBe(keepPreviousData);
  });
});
