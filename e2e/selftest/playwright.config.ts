// Only for selftest/run.ts: a tiny suite with no browser, reported by the
// same no-skips reporter as the real suite.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "fixture",
  outputDir: "../test-results/selftest",
  workers: 1,
  reporter: [["line"], ["../support/no-skips-reporter.ts"]],
});
