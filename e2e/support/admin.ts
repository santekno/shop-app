// The admin dashboard (Bab 12) as the specs drive it: its staff accounts,
// made the way a developer makes them (`make seed-admin`, ADR 0008's
// docs), its login form, and the admin API calls the specs set data up
// with.
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Account } from "./accounts.ts";
import { ADMIN_URL, REPO_ROOT, waitForOk } from "./stack.ts";

/**
 * The staff password of the local stack: a fixture, not a secret. `make
 * seed-admin` reads it from SEED_ADMIN_PASSWORD (never a flag), and so do
 * the specs, so GOSHOP_E2E_STAFF_PASSWORD can replace it.
 */
const STAFF_PASSWORD =
  process.env.GOSHOP_E2E_STAFF_PASSWORD ?? "kopi-susu-gula-aren-e2e-2026";

/** A staff account; name is what cmd/seed gives the role. */
export interface StaffAccount extends Account {
  role: "admin" | "seller";
}

/** The admin the dashboard specs log in with. */
export const ADMIN: StaffAccount = {
  name: "Admin",
  email: "e2e-admin@goshop.local",
  password: STAFF_PASSWORD,
  role: "admin",
};

/** The seller: the dashboard without the admin's cancel (artikel 08). */
export const SELLER: StaffAccount = {
  name: "Seller",
  email: "e2e-seller@goshop.local",
  password: STAFF_PASSWORD,
  role: "seller",
};

/**
 * The database `make seed-admin` writes to: the stack's Postgres as this
 * machine reaches it (make test-integration passes DATABASE_URL), the
 * Makefile's own default otherwise.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable";

/**
 * Creates the staff account, or gives the existing one its role and the
 * password again, with `make seed-admin email=… role=…`: what the README
 * tells a developer to run. Idempotent, so every run starts from the same
 * accounts.
 */
export const seedStaff = (account: StaffAccount): void => {
  execFileSync(
    "make",
    [
      "--no-print-directory",
      "seed-admin",
      `email=${account.email}`,
      `role=${account.role}`,
      `DATABASE_URL=${DATABASE_URL}`,
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, SEED_ADMIN_PASSWORD: account.password },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    },
  );
};

/** Fails with a clear message unless the admin container answers. */
export const requireAdminContainer = async (): Promise<void> => {
  try {
    await waitForOk(`${ADMIN_URL}/healthz`, 30_000);
  } catch (error) {
    throw new Error(
      `the admin dashboard container is not answering on ${ADMIN_URL}: start it with the stack (make up, or the Compose admin service)`,
      { cause: error },
    );
  }
};

/** An address in the dashboard, e.g. adminUrl("/pesanan"). */
export const adminUrl = (path: string): string => `${ADMIN_URL}${path}`;

/** The dashboard's main menu. */
export const adminNav = (page: Page) =>
  page.getByRole("navigation", { name: "Menu utama" });

/**
 * Logs account in through the dashboard's form at /masuk (optionally on
 * the way to returnTo) and waits for the dashboard to greet the account.
 */
export const adminLogIn = async (
  page: Page,
  account: StaffAccount,
  returnTo = "/",
): Promise<void> => {
  await page.goto(adminUrl(`/masuk?kembali=${encodeURIComponent(returnTo)}`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Masuk" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Kata sandi").fill(account.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(adminNav(page)).toBeVisible();
  // The header's account menu, named after the account.
  await expect(
    page.locator("header").getByRole("button", { name: account.name }).first(),
  ).toBeVisible();
};

/**
 * Waits until the dashboard's order feed is open ("Langsung"), so an
 * event published after this is seen live.
 */
export const expectFeedLive = async (page: Page): Promise<void> => {
  await expect(page.getByText("Langsung", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
};
