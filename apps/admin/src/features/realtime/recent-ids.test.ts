import { describe, expect, it } from "vitest";
import { createRecentIds } from "./recent-ids.ts";

describe("createRecentIds", () => {
  it("is true the first time and false for a repeat", () => {
    const ids = createRecentIds();

    expect(ids.add("a")).toBe(true);
    expect(ids.add("b")).toBe(true);
    expect(ids.add("a")).toBe(false);
  });

  it("forgets the oldest id once it holds more than its capacity", () => {
    const ids = createRecentIds(2);
    ids.add("a");
    ids.add("b");
    ids.add("c");

    expect(ids.add("b")).toBe(false);
    expect(ids.add("c")).toBe(false);
    expect(ids.add("a")).toBe(true);
  });

  it("remembers 500 ids by default", () => {
    const ids = createRecentIds();
    for (let i = 0; i < 500; i++) ids.add(String(i));

    expect(ids.add("0")).toBe(false);
    ids.add("500");
    expect(ids.add("1")).toBe(false);
    // "0" was refreshed by nothing: add() of a repeat does not move it,
    // so adding "500" evicted it.
    expect(ids.add("0")).toBe(true);
  });
});
