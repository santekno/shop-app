import { describe, expect, it } from "vitest";
import { plain } from "@/test/text.ts";
import {
  formatCount,
  formatDate,
  formatDateRange,
  formatPeriodLabel,
  formatPeriodTick,
  formatRupiahCompact,
  periodDays,
  periodEnd,
} from "./report-format.ts";

const october = { from: "2026-10-01", to: "2026-10-31" };

describe("formatRupiahCompact", () => {
  it.each([
    [0, "Rp0"],
    [999, "Rp999"],
    [550_000, "Rp550 rb"],
    [1_650_000, "Rp1,65 jt"],
    [1_200_000_000, "Rp1,2 M"],
  ])("writes %d as %s", (amount, text) => {
    expect(plain(formatRupiahCompact(amount))).toBe(text);
  });
});

describe("formatCount", () => {
  it("groups thousands with a dot", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1_250)).toBe("1.250");
  });
});

describe("periodEnd", () => {
  it("is the day itself for a day and six days later for a week", () => {
    expect(periodEnd("2026-10-30", "day")).toBe("2026-10-30");
    expect(periodEnd("2026-10-26", "week")).toBe("2026-11-01");
  });

  it("is the month's last day, February included", () => {
    expect(periodEnd("2026-10-01", "month")).toBe("2026-10-31");
    expect(periodEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(periodEnd("2028-02-01", "month")).toBe("2028-02-29");
    expect(periodEnd("2026-12-01", "month")).toBe("2026-12-31");
  });
});

describe("periodDays", () => {
  it("is the whole period when it lies inside the range", () => {
    expect(periodDays("2026-10-05", "week", october)).toEqual({
      first: "2026-10-05",
      last: "2026-10-11",
      partial: false,
    });
  });

  it("clips a first week that starts before the range", () => {
    expect(periodDays("2026-09-28", "week", october)).toEqual({
      first: "2026-10-01",
      last: "2026-10-04",
      partial: true,
    });
  });

  it("clips a last month that ends after the range", () => {
    expect(
      periodDays("2026-10-01", "month", {
        from: "2026-10-01",
        to: "2026-10-15",
      }),
    ).toEqual({
      first: "2026-10-01",
      last: "2026-10-15",
      partial: true,
    });
  });
});

describe("formatDate and formatDateRange", () => {
  it("writes one date as '1 Okt 2026'", () => {
    expect(plain(formatDate("2026-10-01"))).toBe("1 Okt 2026");
  });

  it("writes one date when the range is one day", () => {
    expect(plain(formatDateRange("2026-10-30", "2026-10-30"))).toBe(
      "30 Okt 2026",
    );
  });

  it.each([
    ["2026-10-01", "2026-10-07", "1–7 Okt 2026"],
    ["2026-09-28", "2026-10-04", "28 Sep – 4 Okt 2026"],
    ["2026-12-30", "2027-01-05", "30 Des 2026 – 5 Jan 2027"],
  ])("writes %s to %s as %s", (from, to, text) => {
    expect(plain(formatDateRange(from, to))).toBe(text);
  });

  it("formats in UTC, so no date moves a day in another time zone", () => {
    // The process runs in whatever zone the machine has; the label must
    // not depend on it.
    expect(plain(formatDate("2026-01-01"))).toBe("1 Jan 2026");
  });
});

describe("formatPeriodTick", () => {
  it("writes a day as '12 Okt' and a month as 'Okt 2026'", () => {
    expect(plain(formatPeriodTick("2026-10-12", "day", october))).toBe(
      "12 Okt",
    );
    expect(plain(formatPeriodTick("2026-10-01", "month", october))).toBe(
      "Okt 2026",
    );
  });

  it("starts a clipped week at the range's first day", () => {
    expect(plain(formatPeriodTick("2026-09-28", "week", october))).toBe(
      "1 Okt",
    );
  });
});

describe("formatPeriodLabel", () => {
  it("writes a day in full", () => {
    expect(plain(formatPeriodLabel("2026-10-30", "day", october))).toBe(
      "Jumat, 30 Oktober 2026",
    );
  });

  it("writes a whole week as its days and a whole month by its name", () => {
    expect(plain(formatPeriodLabel("2026-10-05", "week", october))).toBe(
      "5–11 Okt 2026",
    );
    expect(plain(formatPeriodLabel("2026-10-01", "month", october))).toBe(
      "Oktober 2026",
    );
  });

  it("marks a clipped period '(sebagian)' and shows only the counted days", () => {
    expect(plain(formatPeriodLabel("2026-09-28", "week", october))).toBe(
      "1–4 Okt 2026 (sebagian)",
    );
    expect(
      plain(
        formatPeriodLabel("2026-10-01", "month", {
          from: "2026-10-10",
          to: "2026-10-31",
        }),
      ),
    ).toBe("10–31 Okt 2026 (sebagian)");
  });
});
