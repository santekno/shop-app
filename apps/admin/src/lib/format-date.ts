// One formatter for the whole app, like formatRupiah: building an
// Intl.DateTimeFormat is far slower than using one, and a table formats
// two dates per row.
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * An API timestamp (RFC 3339, UTC) as the seller reads it, in the
 * browser's time zone: "3 Nov 2026, 17.15".
 *
 * Returns "" for a value that is not a date, instead of "Invalid Date".
 */
export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateTime.format(date);
};
