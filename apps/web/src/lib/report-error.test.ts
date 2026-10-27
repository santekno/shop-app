import { ApiError } from "@goshop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportCaughtError } from "./report-error.ts";

const apiError = (code: string, status = 500) =>
  new ApiError({ status, code, message: "x" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportCaughtError", () => {
  it("leaves out the expected NOT_FOUND", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportCaughtError(apiError("NOT_FOUND", 404), "stack");

    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["another ApiError", apiError("INTERNAL_ERROR")],
    ["a 404 that is not NOT_FOUND", apiError("CART_NOT_FOUND", 404)],
    ["a TypeError", new TypeError("x is undefined")],
    ["a thrown string", "boom"],
  ])("logs %s with its context", (_, error) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportCaughtError(error, "in RootLayout");

    expect(log).toHaveBeenCalledExactlyOnceWith(error, "in RootLayout");
  });
});
