import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff.ts";

const policy = { baseMs: 1_000, capMs: 30_000 };

describe("backoffDelay", () => {
  it.each([
    [0, 500, 1_000],
    [1, 1_000, 2_000],
    [2, 2_000, 4_000],
    [3, 4_000, 8_000],
    [4, 8_000, 16_000],
    [5, 15_000, 30_000],
    [50, 15_000, 30_000],
  ])(
    "waits between half and all of the doubled base after %d failures",
    (failures, low, high) => {
      expect(backoffDelay(failures, policy, () => 0)).toBe(low);
      expect(backoffDelay(failures, policy, () => 0.5)).toBe((low + high) / 2);
      expect(backoffDelay(failures, policy, () => 1)).toBe(high);
    },
  );

  it("stays finite however many failures there were", () => {
    expect(backoffDelay(10_000, policy, () => 1)).toBe(30_000);
  });

  it("uses Math.random by default, within the bounds", () => {
    const delay = backoffDelay(0, policy);

    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(1_000);
  });
});
