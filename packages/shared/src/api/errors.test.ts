import { describe, expect, expectTypeOf, it } from "vitest";
import { ApiError, isApiError, isErrorBody } from "./errors.ts";

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

describe("isApiError", () => {
  const notFound = new ApiError({
    status: 404,
    code: "NOT_FOUND",
    message: "missing",
  });

  it("matches any ApiError when no codes are given", () => {
    expect(isApiError(notFound)).toBe(true);
    expect(
      isApiError(
        new ApiError({ status: 0, code: "SOMETHING_NEW", message: "" }),
      ),
    ).toBe(true);
  });

  it("matches only the given codes", () => {
    expect(isApiError(notFound, "NOT_FOUND")).toBe(true);
    expect(isApiError(notFound, "TIMEOUT", "NOT_FOUND")).toBe(true);
    expect(isApiError(notFound, "TIMEOUT")).toBe(false);
    expect(isApiError(notFound, "TIMEOUT", "RATE_LIMITED")).toBe(false);
  });

  it.each([
    ["a plain Error", new Error("NOT_FOUND")],
    [
      "a look-alike object",
      { name: "ApiError", status: 404, code: "NOT_FOUND" },
    ],
    ["a string", "NOT_FOUND"],
    ["null", null],
    ["undefined", undefined],
  ])("returns false for %s", (_, value) => {
    expect(isApiError(value)).toBe(false);
    expect(isApiError(value, "NOT_FOUND")).toBe(false);
  });

  it("narrows an unknown value to ApiError", () => {
    const caught: unknown = notFound;
    if (!isApiError(caught, "NOT_FOUND")) {
      throw new Error("expected an ApiError");
    }
    expectTypeOf(caught).toEqualTypeOf<ApiError>();
    expect(caught.status).toBe(404);
  });

  it("accepts only codes the API documents", () => {
    // @ts-expect-error "NOT_FOUN" is a typo, not an ApiErrorCode
    expect(isApiError(notFound, "NOT_FOUN")).toBe(false);
  });
});
