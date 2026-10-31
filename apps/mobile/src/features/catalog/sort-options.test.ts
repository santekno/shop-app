import { describe, expect, it } from "@jest/globals";

import { DEFAULT_SORT, SORT_OPTIONS, sortFromParam } from "./sort-options";

describe("sortFromParam", () => {
  it.each([
    ["terbaru", "newest", "Terbaru"],
    ["termurah", "price_asc", "Harga terendah"],
    ["termahal", "price_desc", "Harga tertinggi"],
  ])("reads urut=%s as %s (%s)", (param, value, label) => {
    expect(sortFromParam(param)).toEqual({ value, param, label });
  });

  it.each([
    ["undefined", undefined],
    ["an unknown word", "acak"],
    ["the API's value instead of the word", "price_desc"],
    ["a different case", "Termurah"],
    ["an array", ["termurah"]],
  ])("falls back to Terbaru for %s", (_name, param) => {
    expect(sortFromParam(param)).toBe(DEFAULT_SORT);
    expect(sortFromParam(param).label).toBe("Terbaru");
  });

  it("offers the three orders, newest first as the default", () => {
    expect(SORT_OPTIONS.map((option) => option.param)).toEqual([
      "terbaru",
      "termurah",
      "termahal",
    ]);
    expect(DEFAULT_SORT.value).toBe("newest");
  });
});
