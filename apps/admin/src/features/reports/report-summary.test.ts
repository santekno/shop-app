import { describe, expect, it } from "vitest";
import { period, salesReport } from "@/test/fixtures.ts";
import { plain } from "@/test/text.ts";
import { toChartRows } from "./chart-rows.ts";
import {
  chartSummary,
  periodWord,
  reportRangeLabel,
} from "./report-summary.ts";

describe("periodWord", () => {
  it.each([
    ["day", "hari"],
    ["week", "minggu"],
    ["month", "bulan"],
  ] as const)("calls a %s period '%s'", (group, word) => {
    expect(periodWord(salesReport({ group }))).toBe(word);
  });

  it("says 'periode' for a grouping it does not know", () => {
    expect(periodWord(salesReport({ group: "year" as "day" }))).toBe("periode");
  });
});

describe("chartSummary", () => {
  it("names the best day and counts the days without a sale", () => {
    expect(plain(chartSummary(salesReport(), "revenue"))).toBe(
      "Tertinggi Rp 300.000 pada Jumat, 30 Oktober 2026. 1 dari 3 hari tanpa penjualan.",
    );
  });

  it("names the day with most orders for the orders chart", () => {
    expect(plain(chartSummary(salesReport(), "orders"))).toBe(
      "Terbanyak 3 pesanan pada Jumat, 30 Oktober 2026. 1 dari 3 hari tanpa penjualan.",
    );
  });

  it("keeps the first of two equal periods", () => {
    const report = salesReport({
      series: [
        period("2026-10-28", 2),
        period("2026-10-29", 2),
        period("2026-10-30", 1),
      ],
    });

    expect(plain(chartSummary(report, "orders"))).toMatch(
      /^Terbanyak 2 pesanan pada Rabu, 28 Oktober 2026\./,
    );
  });

  it("says every period had a sale when none is empty", () => {
    const report = salesReport({
      series: [period("2026-10-29", 1), period("2026-10-30", 1)],
    });

    expect(plain(chartSummary(report, "revenue"))).toBe(
      "Tertinggi Rp 100.000 pada Kamis, 29 Oktober 2026. Setiap hari ada penjualan.",
    );
  });

  it("says there was no sale for an empty or all-zero series", () => {
    expect(chartSummary(salesReport({ series: [] }), "revenue")).toBe(
      "Tidak ada penjualan pada rentang ini.",
    );
    expect(
      chartSummary(
        salesReport({ series: [period("2026-10-30", 0)] }),
        "orders",
      ),
    ).toBe("Tidak ada penjualan pada rentang ini.");
  });

  it("uses the grouping's word and the clipped period's label", () => {
    const report = salesReport({
      from: "2026-10-01",
      to: "2026-10-31",
      group: "week",
      series: [period("2026-09-28", 4), period("2026-10-05", 0)],
    });

    expect(plain(chartSummary(report, "orders"))).toBe(
      "Terbanyak 4 pesanan pada 1–4 Okt 2026 (sebagian). 1 dari 2 minggu tanpa penjualan.",
    );
  });
});

describe("reportRangeLabel", () => {
  it("is the report's own range", () => {
    expect(plain(reportRangeLabel(salesReport()))).toBe("28–30 Okt 2026");
  });
});

describe("toChartRows", () => {
  it("turns each period's Money into whole rupiah, keyed by name", () => {
    expect(
      toChartRows(salesReport({ series: [period("2026-10-30", 3, 500_000)] })),
    ).toEqual([
      {
        period: "2026-10-30",
        revenue: 300_000,
        orders: 3,
        average: 100_000,
        cumulative: 500_000,
      },
    ]);
  });

  it("is empty for an empty series", () => {
    expect(toChartRows(salesReport({ series: [] }))).toEqual([]);
  });
});
