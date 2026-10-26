// Fixture for selftest/run.ts: passes, skips or fails on demand.
import { expect, test } from "@playwright/test";

test("passes", () => {
  expect(1 + 1).toBe(2);
});

test("skips when SELFTEST_SKIP is set", () => {
  test.skip(process.env.SELFTEST_SKIP === "1", "POSTGRES_DSN not set");
});

test("is fixme when SELFTEST_FIXME is set", () => {
  test.fixme(process.env.SELFTEST_FIXME === "1", "not ready");
});

test("fails when SELFTEST_FAIL is set", () => {
  expect(process.env.SELFTEST_FAIL).toBeUndefined();
});
