// Login against the real API: a verified buyer signs in and is greeted in
// the header, the session stays in memory, and a wrong password gets the
// API's INVALID_CREDENTIALS as a message on the form.
import { expect, test } from "@playwright/test";
import { BUYER } from "../support/accounts.ts";
import { authPosts, expectOnlyStatusErrors, nav } from "../support/auth.ts";
import { watchBrowser } from "../support/browser.ts";

test("a verified buyer logs in, is greeted in the header, and logs out", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const logins = authPosts(page, "login");

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(BUYER.email);
  await page.getByLabel("Kata sandi").fill(BUYER.password);
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page).toHaveURL("/");
  await expect(nav(page).getByText(`Halo, ${BUYER.name}`)).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Masuk" })).toHaveCount(0);
  expect(logins).toHaveLength(1);
  expect(logins[0]?.postDataJSON()).toEqual({
    email: BUYER.email,
    password: BUYER.password,
  });
  expect((await logins[0]?.response())?.status()).toBe(200);
  // The session lives in memory only: nothing about it in web storage.
  const stored = await page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
  expect(stored).toEqual({ local: [], session: [] });

  await nav(page).getByRole("button", { name: "Keluar" }).click();
  await expect(nav(page).getByRole("link", { name: "Masuk" })).toBeVisible();
  await expect(nav(page).getByText(`Halo, ${BUYER.name}`)).toHaveCount(0);
  expectOnlyStatusErrors(problems, []);
});

test("a wrong password gets INVALID_CREDENTIALS as a message on the form", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const logins = authPosts(page, "login");

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(BUYER.email);
  await page.getByLabel("Kata sandi").fill("bukan-kata-sandinya");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Email atau kata sandi salah.",
  );
  await expect(page).toHaveURL("/masuk");
  expect((await logins[0]?.response())?.status()).toBe(401);
  await expect(nav(page).getByRole("link", { name: "Masuk" })).toBeVisible();
  expectOnlyStatusErrors(problems, [401]);
});
