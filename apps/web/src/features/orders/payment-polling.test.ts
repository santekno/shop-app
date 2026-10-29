import { describe, expect, it } from "vitest";
import { POLL_LIMIT_MS, pollDelay } from "./payment-polling.ts";

describe("pollDelay", () => {
  it("asks often at first, then slower, Fibonacci-like", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(pollDelay)).toEqual([
      2_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000,
    ]);
  });

  it("never waits longer than 30 seconds", () => {
    expect(pollDelay(9)).toBe(30_000);
    expect(pollDelay(500)).toBe(30_000);
  });

  it("starts at the first delay before any answer", () => {
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(-3)).toBe(2_000);
  });

  it("lasts a quarter of an hour per round", () => {
    expect(POLL_LIMIT_MS).toBe(15 * 60 * 1_000);
  });
});
