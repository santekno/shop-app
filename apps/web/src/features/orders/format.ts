/**
 * A date and time from the API (RFC 3339, UTC) in the buyer's own time
 * zone: Indonesia has three, and the browser knows which one the buyer is
 * in. One formatter for the feature, built once.
 */
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeStyle: "short",
});

export const formatDateTime = (iso: string): string =>
  dateTime.format(new Date(iso));
