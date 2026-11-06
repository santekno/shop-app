import { describe, expect, it } from "@jest/globals";

import { applyToggle } from "./wishlist-state";

describe("applyToggle", () => {
  it("saving puts the slug first", () => {
    expect(applyToggle(["a", "b"], "c", true)).toEqual(["c", "a", "b"]);
  });

  it("saving a slug already there changes nothing, and returns the same array", () => {
    const list = ["a", "b"];

    expect(applyToggle(list, "b", true)).toBe(list);
  });

  it("removing takes the slug out and keeps the order of the rest", () => {
    expect(applyToggle(["a", "b", "c"], "b", false)).toEqual(["a", "c"]);
  });

  it("removing a slug that is not there returns the same array", () => {
    const list = ["a"];

    expect(applyToggle(list, "z", false)).toBe(list);
  });

  it("treats a list that has not loaded as empty", () => {
    expect(applyToggle(undefined, "a", true)).toEqual(["a"]);
    expect(applyToggle(undefined, "a", false)).toEqual([]);
  });
});
