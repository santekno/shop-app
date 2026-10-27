// Helpers for the web session specs (Bab 10, ADR 0008): logging in through
// the form, the goshop_refresh cookie as the browser holds it, and the
// answers of POST /v1/auth/web/refresh.
import { expect } from "@playwright/test";
import type { BrowserContext, Cookie, Page, Response } from "@playwright/test";
import type { Account } from "./accounts.ts";
import { nav } from "./auth.ts";
import { API_URL, BROWSER_API_URL } from "./stack.ts";

/** The web refresh endpoint: also a URL under the cookie's Path. */
export const WEB_REFRESH_URL = `${BROWSER_API_URL}/v1/auth/web/refresh`;

/** The header's account menu button, named after the buyer. */
export const greeting = (page: Page, account: Account) =>
  nav(page).getByRole("button", { name: `Halo, ${account.name}` });

/** The header's Masuk link, shown to a guest. */
export const masukLink = (page: Page) =>
  nav(page).getByRole("link", { name: "Masuk" });

/** Fills the Masuk form on the current page and submits it. */
export const submitLogin = async (
  page: Page,
  account: Account,
): Promise<void> => {
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Kata sandi").fill(account.password);
  await page.getByRole("button", { name: "Masuk" }).click();
};

/** Opens /masuk, logs in, and waits for the header to greet the buyer. */
export const logIn = async (page: Page, account: Account): Promise<void> => {
  await page.goto("/masuk");
  await submitLogin(page, account);
  await expect(greeting(page, account)).toBeVisible();
};

/** Logs out through the account menu and waits for the Masuk link. */
export const logOut = async (page: Page, account: Account): Promise<void> => {
  await greeting(page, account).click();
  await page.getByRole("menuitem", { name: "Keluar" }).click();
  await expect(masukLink(page)).toBeVisible();
};

/** The goshop_refresh cookie the browser holds, if any. */
export const refreshCookie = async (
  context: BrowserContext,
): Promise<Cookie | undefined> =>
  (await context.cookies(WEB_REFRESH_URL)).find(
    (cookie) => cookie.name === "goshop_refresh",
  );

/**
 * Records every answer to POST /v1/auth/web/refresh that pages of target
 * (one page, or every page of a context) get, in order.
 */
export const webRefreshes = (target: Page | BrowserContext): Response[] => {
  const responses: Response[] = [];
  target.on("response", (response) => {
    if (
      response.url() === WEB_REFRESH_URL &&
      response.request().method() === "POST"
    ) {
      responses.push(response);
    }
  });
  return responses;
};

/** The access token in a 200 answer from a web login or refresh. */
export const accessTokenOf = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { data: { access_token: string } };
  return body.data.access_token;
};

/**
 * Every web storage entry of the page as "key=value": what a script
 * injected into the page could read.
 */
export const webStorage = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [window.localStorage, window.sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`),
    ),
  );

/**
 * Ends a session on the server the way the mobile app's logout does, with
 * the cookie's refresh token in the body: what a logout on another device
 * or a revoked session looks like to this browser.
 */
export const revokeSession = async (refreshToken: string): Promise<void> => {
  const response = await fetch(`${API_URL}/v1/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (response.status !== 204) {
    throw new Error(`POST /v1/auth/logout = ${response.status}, want 204`);
  }
};
