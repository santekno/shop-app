import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format-date.ts";

describe("formatDateTime", () => {
  it("formats an API timestamp the Indonesian way, in the browser's zone", () => {
    const iso = "2026-11-03T10:15:00Z";
    const expected = new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

    expect(formatDateTime(iso)).toBe(expected);
    expect(formatDateTime(iso)).toMatch(/2026/);
  });

  it.each(["", "kemarin", "2026-13-45T99:00:00Z"])(
    "is empty for %j, never 'Invalid Date'",
    (value) => {
      expect(formatDateTime(value)).toBe("");
    },
  );
});
