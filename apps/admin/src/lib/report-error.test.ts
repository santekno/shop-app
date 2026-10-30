import { afterEach, describe, expect, it, vi } from "vitest";
import { reportCaughtError } from "./report-error.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportCaughtError", () => {
  it("logs the error with its context once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");

    reportCaughtError(error, { routeId: "0-1" });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(error, { routeId: "0-1" });
  });
});
