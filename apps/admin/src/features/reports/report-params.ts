import type { SalesReportGroup, SalesReportQuery } from "@goshop/shared";

/**
 * The sales report's state, as read from the URL: which days, grouped by
 * what. Every value is one the API accepts; readReportParams makes sure.
 *
 * A range is either a preset ("the last 30 days", which moves with the
 * calendar: a bookmark of it shows the last 30 days whenever it is
 * opened) or two fixed dates ("1 to 31 October", which never moves).
 */
export type ReportRange =
  | { kind: "preset"; days: PresetDays }
  | { kind: "custom"; from: string; to: string };

export interface ReportParams {
  range: ReportRange;
  group: SalesReportGroup;
}

/** The presets: the last 7, 30 or 90 days, today included. */
export const PRESET_DAYS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];

/** 30 days, the API's own default when no date is given. */
export const DEFAULT_PRESET: PresetDays = 30;

/** The longest range the API reports, both days included. */
export const MAX_RANGE_DAYS = 366;

/**
 * The groupings: the API's value, the word in the URL (Indonesian, like
 * the paths) and what the menu and the chart's title say. `satisfies`
 * checks every value against the generated type.
 */
export const GROUP_OPTIONS = [
  { value: "day", param: "hari", label: "Per hari", period: "hari" },
  { value: "week", param: "minggu", label: "Per minggu", period: "minggu" },
  { value: "month", param: "bulan", label: "Per bulan", period: "bulan" },
] as const satisfies readonly {
  value: SalesReportGroup;
  param: string;
  label: string;
  period: string;
}[];

export const DEFAULT_PARAMS: ReportParams = {
  range: { kind: "preset", days: DEFAULT_PRESET },
  group: "day",
};

// --- Calendar dates -------------------------------------------------------
//
// A report date is a calendar date in Jakarta, "2026-10-30", with no time
// and no time zone. It is handled as a string and, for arithmetic, as
// midnight UTC of that date: adding a day to midnight UTC can never cross
// a daylight-saving change (UTC has none), so the date after 2026-10-30
// is always 2026-10-31, whatever the browser's own time zone is.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Western Indonesia Time is UTC+7 all year: Jakarta has no daylight saving. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The time of `iso` ("YYYY-MM-DD") at midnight UTC, or undefined when it
 * is not a calendar date. "2026-02-30" is refused, as Go's time.Parse
 * (the API's `datetime=2006-01-02` rule) refuses it, instead of becoming
 * 2 March as `new Date` would make it.
 */
export const parseIsoDate = (iso: string): number | undefined => {
  const match = ISO_DATE.exec(iso);
  if (match === null) return undefined;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const time = Date.UTC(y, m - 1, d);
  const date = new Date(time);
  // Date.UTC rolls an impossible day over into the next month; a date
  // that does not come back unchanged was not a real one. Years before
  // 1000 are refused too: Date.UTC reads 0–99 as 1900–1999.
  return y >= 1000 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? time
    : undefined;
};

/** Midnight UTC of a date, back to "YYYY-MM-DD". */
const toIsoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** `iso` moved by `days` (negative goes back). `iso` must be valid. */
export const addDays = (iso: string, days: number): string =>
  toIsoDate((parseIsoDate(iso) ?? Number.NaN) + days * DAY_MS);

/** Today in Jakarta, as the API's "today": the date at UTC+7. */
export const jakartaToday = (now: Date = new Date()): string =>
  toIsoDate(now.getTime() + WIB_OFFSET_MS);

/** How many days from `from` to `to`, both included (1 for one day). */
export const rangeDays = (from: string, to: string): number =>
  Math.round(
    ((parseIsoDate(to) ?? Number.NaN) - (parseIsoDate(from) ?? Number.NaN)) /
      DAY_MS,
  ) + 1;

// --- Validation -------------------------------------------------------------

/** What is wrong with a custom range, per field; empty when nothing is. */
export interface RangeErrors {
  from?: string;
  to?: string;
}

/**
 * The API's rules for `from` and `to`, checked before the request (the
 * handler's `datetime=2006-01-02` tags and report.ErrRange): both are
 * calendar dates, `to` is not before `from`, and the range is at most 366
 * days, both included. The API checks them again; this only says it
 * sooner, in words, on the field that needs the change.
 *
 * Unlike the API, both dates are required here: the API's defaults for a
 * missing date ("29 days before to", "today") are what the presets are
 * for, and a half-filled form is more likely a slip than a wish.
 */
export const rangeErrors = (from: string, to: string): RangeErrors => {
  const errors: RangeErrors = {};
  const fromTime = parseIsoDate(from);
  const toTime = parseIsoDate(to);
  if (from === "") errors.from = "Pilih tanggal mulai.";
  else if (fromTime === undefined)
    errors.from = "Tulis tanggal yang ada, misalnya 2026-10-01.";
  if (to === "") errors.to = "Pilih tanggal akhir.";
  else if (toTime === undefined)
    errors.to = "Tulis tanggal yang ada, misalnya 2026-10-31.";
  if (fromTime === undefined || toTime === undefined) return errors;

  if (toTime < fromTime) {
    errors.to = "Tanggal akhir tidak boleh sebelum tanggal mulai.";
  } else if (rangeDays(from, to) > MAX_RANGE_DAYS) {
    errors.to = `Rentang paling panjang ${MAX_RANGE_DAYS} hari; yang dipilih ${rangeDays(from, to).toLocaleString("id-ID")} hari.`;
  }
  return errors;
};

export const hasRangeErrors = (errors: RangeErrors): boolean =>
  errors.from !== undefined || errors.to !== undefined;

// --- The URL ----------------------------------------------------------------
//
//   /laporan                                  the last 30 days, per day
//   /laporan?rentang=7                        the last 7 days
//   /laporan?dari=2026-10-01&sampai=2026-10-31&kelompok=minggu
//
// Defaults are left out, and the parameters have a fixed order, so equal
// states give equal URLs (as the product table does).

/**
 * The report's state from the query string. The URL is input, checked
 * like a request: anything the API would refuse falls back to the
 * default (a range of 400 days, "2026-02-30", `?kelompok=tahun`), so a
 * typed or stale link shows a report instead of an error. Two valid
 * dates win over `rentang`.
 */
export const readReportParams = (search: URLSearchParams): ReportParams => {
  const group =
    GROUP_OPTIONS.find((option) => option.param === search.get("kelompok"))
      ?.value ?? DEFAULT_PARAMS.group;

  const from = search.get("dari");
  const to = search.get("sampai");
  if (from !== null && to !== null && !hasRangeErrors(rangeErrors(from, to))) {
    return { range: { kind: "custom", from, to }, group };
  }

  const days = PRESET_DAYS.find(
    (preset) => String(preset) === search.get("rentang"),
  );
  return {
    range: { kind: "preset", days: days ?? DEFAULT_PRESET },
    group,
  };
};

/** The query string for `params`, defaults left out. */
export const reportSearchParams = (params: ReportParams): URLSearchParams => {
  const search = new URLSearchParams();
  const { range, group } = params;
  if (range.kind === "custom") {
    search.set("dari", range.from);
    search.set("sampai", range.to);
  } else if (range.days !== DEFAULT_PRESET) {
    search.set("rentang", String(range.days));
  }
  if (group !== DEFAULT_PARAMS.group) {
    const option = GROUP_OPTIONS.find((item) => item.value === group);
    if (option !== undefined) search.set("kelompok", option.param);
  }
  return search;
};

/**
 * The two dates a range covers, given today in Jakarta: a preset of N
 * days ends today and starts N − 1 days before it.
 */
export const resolveRange = (
  range: ReportRange,
  today: string,
): { from: string; to: string } =>
  range.kind === "custom"
    ? { from: range.from, to: range.to }
    : { from: addDays(today, -(range.days - 1)), to: today };

/**
 * The API query for `params`. A preset is sent as two dates too, rather
 * than left to the API's defaults: the query key then names exactly which
 * days are in the cache, and after midnight in Jakarta the same preset is
 * a new key, fetched fresh.
 */
export const toSalesReportQuery = (
  params: ReportParams,
  today: string,
): Required<SalesReportQuery> => ({
  ...resolveRange(params.range, today),
  group: params.group,
});
