// Runs once before the suite (playwright.config.ts): fresh rate-limit
// counters, the verified buyer the login specs use, and (Bab 12) the
// dashboard's staff accounts, made with `make seed-admin` once the admin
// container is known to answer.
import { clearRateLimits, ensureBuyer } from "./accounts.ts";
import { ADMIN, SELLER, requireAdminContainer, seedStaff } from "./admin.ts";

export default async function globalSetup(): Promise<void> {
  clearRateLimits();
  await ensureBuyer();
  await requireAdminContainer();
  seedStaff(ADMIN);
  seedStaff(SELLER);
}
