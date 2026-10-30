import type { SalesReportGroup } from "@goshop/shared";
import { addDays, parseIsoDate } from "./report-params.ts";

// Formatters are built once (building an Intl formatter is far slower
// than using one, and a 366-day table formats hundreds of values).
//
// A report date is a Jakarta calendar date with no time ("2026-10-30"),
// handled as midnight UTC (report-params.ts). It is therefore formatted
// in UTC: formatted in the browser's own zone, midnight UTC is still the
// previous evening in New York, and every label would be a day early.

// Two decimals at most: an axis step of 1.650.000 reads "1,65 jt", not a
// rounded "1,7 jt" that the next tick would contradict.
const compactNumber = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const wholeNumber = new Intl.NumberFormat("id-ID");

const dayShort = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dayLong = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dayMedium = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const monthShort = new Intl.DateTimeFormat("id-ID", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const monthLong = new Intl.DateTimeFormat("id-ID", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Rupiah in a few characters, for an axis: "Rp0", "Rp550 rb", "Rp1,65 jt",
 * "Rp1,2 M". The full amount is in the tooltip and the table; an axis
 * only has to show the scale.
 */
export const formatRupiahCompact = (amount: number): string =>
  `Rp${compactNumber.format(amount)}`;

/** A count the Indonesian way: 1.250. */
export const formatCount = (value: number): string => wholeNumber.format(value);

/** "2026-10-30" → a Date for Intl, at midnight UTC. */
const asDate = (iso: string) => new Date(parseIsoDate(iso) ?? Number.NaN);

/** The last day of the period that starts on `start`. */
export const periodEnd = (start: string, group: SalesReportGroup): string => {
  if (group === "day") return start;
  if (group === "week") return addDays(start, 6);
  const date = asDate(start);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
};

/**
 * The days of one period that are inside the report's range. The API
 * lists a week or a month by its first day, and the first week (from
 * Monday) or month (from the 1st) may start before `from`, the last may
 * end after `to`; only the days in the range are counted. `partial` says
 * the period was cut, so a short first week is not read as a slow one.
 */
export const periodDays = (
  start: string,
  group: SalesReportGroup,
  range: { from: string; to: string },
): { first: string; last: string; partial: boolean } => {
  const end = periodEnd(start, group);
  // ISO dates compare correctly as strings.
  const first = start < range.from ? range.from : start;
  const last = end > range.to ? range.to : end;
  return { first, last, partial: first !== start || last !== end };
};

/** A date as "1 Okt 2026". */
export const formatDate = (iso: string): string =>
  dayMedium.format(asDate(iso));

/**
 * A range of dates, as short as it reads well: "1–7 Okt 2026",
 * "28 Sep – 4 Okt 2026", "30 Des 2026 – 5 Jan 2027", or one date.
 */
export const formatDateRange = (from: string, to: string): string => {
  if (from === to) return formatDate(from);
  return dayMedium.formatRange(asDate(from), asDate(to));
};

/**
 * A period's label on the chart's axis, short: "12 Okt" for a day or a
 * week (its first day in the range), "Okt 2026" for a month.
 */
export const formatPeriodTick = (
  start: string,
  group: SalesReportGroup,
  range: { from: string; to: string },
): string => {
  if (group === "month") return monthShort.format(asDate(start));
  return dayShort.format(asDate(periodDays(start, group, range).first));
};

/**
 * A period in full, for the tooltip and the table: "Jumat, 30 Oktober
 * 2026", "26 Okt – 1 Nov 2026", "Oktober 2026". A period cut by the range
 * shows only the days that were counted, plus "(sebagian)".
 */
export const formatPeriodLabel = (
  start: string,
  group: SalesReportGroup,
  range: { from: string; to: string },
): string => {
  if (group === "day") return dayLong.format(asDate(start));
  const { first, last, partial } = periodDays(start, group, range);
  const label =
    group === "month" && !partial
      ? monthLong.format(asDate(start))
      : formatDateRange(first, last);
  return partial ? `${label} (sebagian)` : label;
};
