// Login against the real API: a verified buyer signs in through the web
// session endpoint (Bab 10, ADR 0008) and is greeted in the header, the
// access token stays in memory and the refresh token in an httpOnly
// cookie, and a wrong password gets the API's INVALID_CREDENTIALS as a
// message on the form, which takes the focus.
import { expect, test } from "@playwright/test";
import { BUYER } from "../support/accounts.ts";
import { authPosts, expectOnlyStatusErrors, nav } from "../support/auth.ts";
import { watchBrowser, pageAlerts } from "../support/browser.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

/** A URL under the refresh cookie's Path, where the browser sends it. */
const SESSION_URL = `${BROWSER_API_URL}/v1/auth/web/refresh`;

test("a verified buyer logs in, is greeted in the header, and logs out", async ({
  page,
  context,
}) => {
  const problems = await watchBrowser(page);
  const logins = authPosts(page, "web/login");
  const logouts = authPosts(page, "web/logout");

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
  expect(logins[0]?.headers()["x-goshop-client"]).toBe("web");
  const answer = await logins[0]?.response();
  expect(answer?.status()).toBe(200);
  const { data } = (await answer?.json()) as {
    data: { access_token: string };
  };
  expect(Object.keys(data)).not.toContain("refresh_token");

  // The access token lives in memory only: in no web storage value.
  const stored = await page.evaluate(() =>
    [window.localStorage, window.sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`),
    ),
  );
  expect(stored.filter((entry) => entry.includes(data.access_token))).toEqual(
    [],
  );
  // The refresh token is in a cookie page scripts cannot read, sent to
  // the web auth endpoints only.
  const cookies = await context.cookies(SESSION_URL);
  expect(cookies.map((c) => c.name)).toEqual(["goshop_refresh"]);
  expect(cookies[0]).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1/auth/web",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "goshop_refresh",
  );

  // Keluar lives in the account menu under the buyer's name.
  await nav(page)
    .getByRole("button", { name: `Halo, ${BUYER.name}` })
    .click();
  await page.getByRole("menuitem", { name: "Keluar" }).click();
  await expect(nav(page).getByRole("link", { name: "Masuk" })).toBeVisible();
  await expect(nav(page).getByText(`Halo, ${BUYER.name}`)).toHaveCount(0);
  expect(logouts).toHaveLength(1);
  expect((await logouts[0]?.response())?.status()).toBe(204);
  expect(await context.cookies(SESSION_URL)).toEqual([]);
  expectOnlyStatusErrors(problems, []);
});

test("a wrong password gets INVALID_CREDENTIALS as a message on the form", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const logins = authPosts(page, "web/login");

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(BUYER.email);
  await page.getByLabel("Kata sandi").fill("bukan-kata-sandinya");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(pageAlerts(page)).toHaveText("Email atau kata sandi salah.");
  // The clicked button was disabled while the request ran, which drops
  // the focus; the message takes it instead of <body>.
  await expect(pageAlerts(page)).toBeFocused();
  await expect(page).toHaveURL("/masuk");
  expect((await logins[0]?.response())?.status()).toBe(401);
  await expect(nav(page).getByRole("link", { name: "Masuk" })).toBeVisible();
  expectOnlyStatusErrors(problems, [401]);
});

test("with the keyboard only, INVALID_CREDENTIALS takes the focus on every try, between the fields and the button", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const logins = authPosts(page, "web/login");
  // An address with no account gets the same INVALID_CREDENTIALS, and its
  // own per-email rate limit: BUYER's attempts stay for the other tests.
  const email = "e2e-tidak-terdaftar@goshop.local";
  const message = pageAlerts(page);

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill("kata-sandi-pertama");
  await page.getByLabel("Kata sandi").press("Enter");

  await expect(message).toHaveText("Email atau kata sandi salah.");
  await expect(message).toBeFocused();
  // Out of the Tab order, but in the middle of it: Tab goes on to the
  // button, Shift+Tab back to the password.
  await expect(message).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Masuk" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Kata sandi")).toBeFocused();

  // Typing does not pull the focus back to the message; a second failure
  // does, although its text is the same.
  await page.getByLabel("Kata sandi").fill("kata-sandi-kedua");
  await expect(page.getByLabel("Kata sandi")).toBeFocused();
  await page.getByLabel("Kata sandi").press("Enter");
  await expect.poll(() => logins.length).toBe(2);
  await expect(message).toBeFocused();
  await expect(message).toHaveText("Email atau kata sandi salah.");
  for (const login of logins) {
    expect((await login.response())?.status()).toBe(401);
  }
  expectOnlyStatusErrors(problems, [401, 401]);
});
