// Runs once before the suite (playwright.config.ts): fresh rate-limit
// counters, then the verified buyer the login specs use.
import { clearRateLimits, ensureBuyer } from "./accounts.ts";

export default async function globalSetup(): Promise<void> {
  clearRateLimits();
  await ensureBuyer();
}
