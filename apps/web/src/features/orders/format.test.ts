import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format.ts";

describe("formatDateTime", () => {
  it("writes the date in Indonesian, in the buyer's own time zone", () => {
    // Midday UTC is 30 October in every Indonesian time zone.
    const iso = "2026-10-30T12:05:00Z";
    const local = new Date(iso);
    const hh = String(local.getHours()).padStart(2, "0");
    const mm = String(local.getMinutes()).padStart(2, "0");

    const text = formatDateTime(iso);

    expect(text).toContain("30 Oktober 2026");
    expect(text).toMatch(new RegExp(`${hh}[.:]${mm}$`));
  });
});
