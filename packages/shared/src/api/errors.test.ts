import { describe, expect, it } from "vitest";
import { ApiError, isErrorBody } from "./errors.ts";

describe("isErrorBody", () => {
  it.each([
    ["without details", { error: { code: "NOT_FOUND", message: "not found" } }],
    [
      "with details",
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "invalid",
          details: { fields: { name: "required" } },
        },
      },
    ],
    ["with empty details", { error: { code: "X", message: "", details: {} } }],
  ])("accepts a valid body %s", (_, value) => {
    expect(isErrorBody(value)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "error"],
    ["an array", [{ error: { code: "X", message: "m" } }]],
    ["an object without error", { code: "X", message: "m" }],
    ["a null error", { error: null }],
    ["an array error", { error: ["X", "m"] }],
    ["a string error", { error: "X" }],
    ["a missing code", { error: { message: "m" } }],
    ["a numeric code", { error: { code: 404, message: "m" } }],
    ["a missing message", { error: { code: "X" } }],
    ["a numeric message", { error: { code: "X", message: 1 } }],
    ["null details", { error: { code: "X", message: "m", details: null } }],
    ["array details", { error: { code: "X", message: "m", details: ["a"] } }],
    ["string details", { error: { code: "X", message: "m", details: "a" } }],
  ])("rejects %s", (_, value) => {
    expect(isErrorBody(value)).toBe(false);
  });
});

describe("ApiError", () => {
  it("carries every field it was given", () => {
    const cause = new TypeError("Failed to fetch");
    const error = new ApiError({
      status: 422,
      code: "VALIDATION_FAILED",
      message: "name is required",
      details: { field: "name" },
      requestId: "req-1",
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("name is required");
    expect(error.status).toBe(422);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toEqual({ field: "name" });
    expect(error.requestId).toBe("req-1");
    expect(error.cause).toBe(cause);
  });

  it("defaults details to {} and leaves requestId and cause unset", () => {
    const error = new ApiError({ status: 0, code: "ABORTED", message: "x" });

    expect(error.details).toEqual({});
    expect(error.requestId).toBeUndefined();
    expect(Object.hasOwn(error, "cause")).toBe(false);
  });
});
