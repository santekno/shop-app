// Playwright settings for the GoShop end-to-end suite. It runs against the
// stack that `make up` starts (make test-integration starts it too): the
// storefront container on GOSHOP_WEB_URL and the API on GOSHOP_API_URL.
import { defineConfig, devices } from "@playwright/test";
import { WEB_URL } from "./support/stack.ts";

export default defineConfig({
  testDir: "tests",
  // One worker, files in order: tests/storefront-outage.spec.ts stops the
  // api container, which no other test may see.
  workers: 1,
  fullyParallel: false,
  // A forgotten test.only must fail the gate, not shrink it to one test.
  forbidOnly: true,
  // A flaky test is a bug to fix, not to retry until it passes.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    // Fails the run when any test was skipped, like scripts/no-skips.sh
    // does for go test: a skipped test proves nothing.
    ["./support/no-skips-reporter.ts"],
  ],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
