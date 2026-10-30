import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  addDays,
  hasRangeErrors,
  jakartaToday,
  parseIsoDate,
  rangeDays,
  rangeErrors,
  readReportParams,
  reportSearchParams,
  resolveRange,
  toSalesReportQuery,
} from "./report-params.ts";
import type { ReportParams } from "./report-params.ts";

const search = (query: string) => new URLSearchParams(query);

describe("parseIsoDate", () => {
  it("is midnight UTC of a calendar date", () => {
    expect(parseIsoDate("2026-10-30")).toBe(Date.UTC(2026, 9, 30));
    expect(parseIsoDate("1000-01-01")).toBe(Date.UTC(1000, 0, 1));
  });

  it("knows leap years", () => {
    expect(parseIsoDate("2028-02-29")).toBe(Date.UTC(2028, 1, 29));
    expect(parseIsoDate("2026-02-29")).toBeUndefined();
    expect(parseIsoDate("2100-02-29")).toBeUndefined();
  });

  it.each([
    ["30 February", "2026-02-30"],
    ["31 April", "2026-04-31"],
    ["month 13", "2026-13-01"],
    ["day 0", "2026-10-00"],
    ["a year before 1000", "0999-12-31"],
    ["a two-digit year", "0026-10-30"],
    ["no zero padding", "2026-1-5"],
    ["a time", "2026-10-30T00:00:00Z"],
    ["slashes", "2026/10/30"],
    ["empty", ""],
    ["text", "kemarin"],
  ])("refuses %s", (_name, value) => {
    expect(parseIsoDate(value)).toBeUndefined();
  });
});

describe("addDays", () => {
  it("moves across months, years and back", () => {
    expect(addDays("2026-10-30", 1)).toBe("2026-10-31");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-30", -29)).toBe("2026-10-01");
    expect(addDays("2026-10-30", 0)).toBe("2026-10-30");
  });
});

describe("jakartaToday", () => {
  it("turns at 17:00 UTC, midnight in Jakarta", () => {
    expect(jakartaToday(new Date("2026-10-30T16:59:59Z"))).toBe("2026-10-30");
    expect(jakartaToday(new Date("2026-10-30T17:00:00Z"))).toBe("2026-10-31");
  });

  it("is the Jakarta date for a moment that is still yesterday in UTC", () => {
    expect(jakartaToday(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("rangeDays", () => {
  it("counts both days", () => {
    expect(rangeDays("2026-10-30", "2026-10-30")).toBe(1);
    expect(rangeDays("2026-10-01", "2026-10-31")).toBe(31);
    expect(rangeDays("2028-01-01", "2028-12-31")).toBe(366);
  });
});

describe("rangeErrors", () => {
  it("is empty for a valid range", () => {
    expect(rangeErrors("2026-10-01", "2026-10-31")).toEqual({});
    expect(hasRangeErrors({})).toBe(false);
  });

  it("asks for both dates when both are empty", () => {
    const errors = rangeErrors("", "");

    expect(errors).toEqual({
      from: "Pilih tanggal mulai.",
      to: "Pilih tanggal akhir.",
    });
    expect(hasRangeErrors(errors)).toBe(true);
  });

  it("names the date that is not a calendar date", () => {
    expect(rangeErrors("2026-02-30", "2026-03-31")).toEqual({
      from: "Tulis tanggal yang ada, misalnya 2026-10-01.",
    });
    expect(rangeErrors("2026-02-01", "2026-02-30")).toEqual({
      to: "Tulis tanggal yang ada, misalnya 2026-10-31.",
    });
  });

  it("refuses an end before the start, on the end", () => {
    expect(rangeErrors("2026-10-31", "2026-10-01")).toEqual({
      to: "Tanggal akhir tidak boleh sebelum tanggal mulai.",
    });
    expect(hasRangeErrors({ to: "x" })).toBe(true);
  });

  it("accepts one day and exactly 366 days", () => {
    expect(rangeErrors("2026-10-30", "2026-10-30")).toEqual({});
    expect(rangeErrors("2026-01-01", "2027-01-01")).toEqual({});
  });

  it("refuses 367 days, saying how many were chosen", () => {
    expect(rangeErrors("2026-01-01", "2027-01-02")).toEqual({
      to: "Rentang paling panjang 366 hari; yang dipilih 367 hari.",
    });
    expect(rangeErrors("2020-01-01", "2026-01-01").to).toBe(
      "Rentang paling panjang 366 hari; yang dipilih 2.193 hari.",
    );
  });
});

describe("readReportParams", () => {
  it("is the default without parameters: 30 days, per day", () => {
    expect(readReportParams(search(""))).toEqual(DEFAULT_PARAMS);
    expect(DEFAULT_PARAMS).toEqual({
      range: { kind: "preset", days: 30 },
      group: "day",
    });
  });

  it.each([
    ["rentang=7", 7],
    ["rentang=90", 90],
    ["rentang=30", 30],
    ["rentang=14", 30],
    ["rentang=abc", 30],
    ["rentang=", 30],
  ])("reads ?%s as the last %d days", (query, days) => {
    expect(readReportParams(search(query)).range).toEqual({
      kind: "preset",
      days,
    });
  });

  it.each([
    ["kelompok=hari", "day"],
    ["kelompok=minggu", "week"],
    ["kelompok=bulan", "month"],
    ["kelompok=tahun", "day"],
    ["kelompok=week", "day"],
  ])("reads ?%s as %s", (query, group) => {
    expect(readReportParams(search(query)).group).toBe(group);
  });

  it("takes two valid dates over rentang", () => {
    expect(
      readReportParams(
        search("rentang=7&dari=2026-10-01&sampai=2026-10-31&kelompok=minggu"),
      ),
    ).toEqual({
      range: { kind: "custom", from: "2026-10-01", to: "2026-10-31" },
      group: "week",
    });
  });

  it.each([
    ["one date only", "dari=2026-10-01&rentang=7"],
    ["an impossible date", "dari=2026-02-30&sampai=2026-03-31&rentang=7"],
    [
      "dates the wrong way round",
      "dari=2026-10-31&sampai=2026-10-01&rentang=7",
    ],
    ["more than 366 days", "dari=2025-01-01&sampai=2026-10-31&rentang=7"],
  ])("falls back to rentang for %s", (_name, query) => {
    expect(readReportParams(search(query)).range).toEqual({
      kind: "preset",
      days: 7,
    });
  });
});

describe("reportSearchParams", () => {
  it("leaves out the defaults", () => {
    expect(reportSearchParams(DEFAULT_PARAMS).toString()).toBe("");
  });

  it("writes a preset, then the grouping", () => {
    expect(
      reportSearchParams({
        range: { kind: "preset", days: 7 },
        group: "month",
      }).toString(),
    ).toBe("rentang=7&kelompok=bulan");
  });

  it("writes two dates instead of rentang for a custom range", () => {
    expect(
      reportSearchParams({
        range: { kind: "custom", from: "2026-10-01", to: "2026-10-31" },
        group: "week",
      }).toString(),
    ).toBe("dari=2026-10-01&sampai=2026-10-31&kelompok=minggu");
  });

  it.each<ReportParams>([
    { range: { kind: "preset", days: 90 }, group: "day" },
    { range: { kind: "preset", days: 30 }, group: "week" },
    {
      range: { kind: "custom", from: "2026-01-01", to: "2026-12-31" },
      group: "month",
    },
  ])("round-trips %j through the URL", (params) => {
    expect(readReportParams(reportSearchParams(params))).toEqual(params);
  });
});

describe("resolveRange and toSalesReportQuery", () => {
  it("ends a preset today and starts it N − 1 days before", () => {
    expect(resolveRange({ kind: "preset", days: 7 }, "2026-10-30")).toEqual({
      from: "2026-10-24",
      to: "2026-10-30",
    });
    expect(resolveRange({ kind: "preset", days: 30 }, "2026-10-30")).toEqual({
      from: "2026-10-01",
      to: "2026-10-30",
    });
  });

  it("keeps a custom range as it is, whatever today is", () => {
    expect(
      resolveRange(
        { kind: "custom", from: "2026-01-01", to: "2026-01-31" },
        "2026-10-30",
      ),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("sends a preset as two dates and the grouping", () => {
    expect(
      toSalesReportQuery(
        { range: { kind: "preset", days: 90 }, group: "month" },
        "2026-10-30",
      ),
    ).toEqual({ from: "2026-08-02", to: "2026-10-30", group: "month" });
  });
});
