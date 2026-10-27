import { describe, expect, it } from "vitest";
import { registeredEmailFrom, registeredState } from "./navigation-state.ts";

describe("registeredState and registeredEmailFrom", () => {
  it("carry the registered email from one page to the next", () => {
    expect(registeredState("budi@example.com")).toEqual({
      registeredEmail: "budi@example.com",
    });
    expect(registeredEmailFrom(registeredState("budi@example.com"))).toBe(
      "budi@example.com",
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "budi@example.com"],
    ["another state", { fromCatalog: true }],
    ["a non-string email", { registeredEmail: 42 }],
  ])("find no email in %s", (_, state) => {
    expect(registeredEmailFrom(state)).toBeUndefined();
  });
});
