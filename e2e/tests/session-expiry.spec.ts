// An access token that runs out (Bab 10, artikel 14). The storefront
// replaces it shortly before it expires (proactive refresh), retries a
// request once after a 401 with a refreshed token, and ends the session,
// back to Masuk, when the refresh itself is refused.
//
// The stack's APP_ACCESS_TOKEN_TTL is 15 minutes, and the suite cannot
// change it per test without restarting the API, so expiry is simulated
// the way the frontend's unit tests do it: the page's clock is moved
// forward (Playwright's page.clock) for the proactive refresh, and the
// first GET /v1/me is answered 401 for the retry. The refused refresh is
// real: the session is revoked on the API, as a logout elsewhere would.
import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { registerBuyer } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import { expectOnlyStatusErrors } from "../support/auth.ts";
import { watchBrowser, pageAlerts } from "../support/browser.ts";
import {
  WEB_REFRESH_URL,
  accessTokenOf,
  greeting,
  logIn,
  masukLink,
  refreshCookie,
  revokeSession,
  webRefreshes,
} from "../support/session.ts";
import { BROWSER_API_URL, WEB_URL } from "../support/stack.ts";

const ME_URL = `${BROWSER_API_URL}/v1/me`;

// Logged in three times by this file.
let account: Account;
test.beforeAll(async () => {
  account = await registerBuyer("kedaluwarsa");
});

/** Opens /akun from the account menu: an in-app navigation, no reload. */
const openAccount = async (page: Page): Promise<void> => {
  await greeting(page, account).click();
  await page.getByRole("menuitem", { name: "Akun saya" }).click();
};

/** The access token a request carries, or undefined. */
const bearerOf = (request: Request): string | undefined =>
  /^Bearer (.+)$/.exec(request.headers().authorization ?? "")?.[1];

test("a token about to expire is replaced before the request that needs it", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.clock.install();
  const refreshes = webRefreshes(page);
  const login = page.waitForResponse(`${BROWSER_API_URL}/v1/auth/web/login`);
  await logIn(page, account);
  const loginToken = await accessTokenOf(await login);

  // From here on: every web refresh and every request with a token.
  const events: string[] = [];
  page.on("request", (request) => {
    if (request.url() === WEB_REFRESH_URL) events.push("refresh");
    else if (bearerOf(request) !== undefined) events.push("bearer");
  });
  const bearers: Request[] = [];
  page.on("request", (request) => {
    if (bearerOf(request) !== undefined) bearers.push(request);
  });

  // 15 minutes later on the page's clock: past expires_in minus the
  // 30-second margin, so the next request must refresh first.
  await page.clock.fastForward("15:00");
  const refreshed = refreshes.length;
  await openAccount(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Akun saya");
  await expect(page.getByRole("main").locator("dd").first()).toHaveText(
    account.name,
  );

  expect(events[0]).toBe("refresh");
  expect(refreshes.length - refreshed).toBe(1);
  const refresh = refreshes[refreshed];
  if (refresh === undefined) throw new Error("no refresh");
  expect(refresh.status()).toBe(200);
  const fresh = await accessTokenOf(refresh);
  expect(fresh).not.toBe(loginToken);
  const me = bearers.filter((request) => request.url() === ME_URL);
  expect(me).toHaveLength(1);
  for (const request of bearers) {
    expect(bearerOf(request)).toBe(fresh);
    expect((await request.response())?.status()).toBe(200);
  }
  expectOnlyStatusErrors(problems, []);
});

test("a 401 is retried once with a refreshed token, and the page never shows it", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const refreshes = webRefreshes(page);
  const login = page.waitForResponse(`${BROWSER_API_URL}/v1/auth/web/login`);
  await logIn(page, account);
  const loginToken = await accessTokenOf(await login);
  const before = refreshes.length;

  // The first GET /v1/me comes back as an expired token would: 401
  // UNAUTHORIZED, with the API's CORS headers. The retry reaches the API.
  const me: Request[] = [];
  await page.route(ME_URL, async (route) => {
    me.push(route.request());
    if (me.length > 1) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": WEB_URL,
        "access-control-expose-headers": "X-Request-ID",
      },
      body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "token expired" },
      }),
    });
  });

  await openAccount(page);
  await expect(page.getByRole("main").locator("dd").first()).toHaveText(
    account.name,
  );
  await expect(pageAlerts(page)).toHaveCount(0);

  expect(me).toHaveLength(2);
  const [expired, retried] = me;
  if (expired === undefined || retried === undefined) {
    throw new Error("GET /v1/me was not sent twice");
  }
  expect(bearerOf(expired)).toBe(loginToken);
  expect(refreshes.length - before).toBe(1);
  const refresh = refreshes[before];
  if (refresh === undefined) throw new Error("no refresh");
  expect(refresh.status()).toBe(200);
  expect(bearerOf(retried)).toBe(await accessTokenOf(refresh));
  expect((await retried.response())?.status()).toBe(200);
  // Chrome logs the simulated 401; nothing else.
  expectOnlyStatusErrors(problems, [401]);
});

test("when the refresh is refused the session ends and /akun sends the buyer to Masuk", async ({
  page,
  context,
}) => {
  const problems = await watchBrowser(page);
  const refreshes = webRefreshes(page);
  await logIn(page, account);
  const before = refreshes.length;

  // Ended on the API (a logout elsewhere, a password reset): the access
  // token in memory and the cookie's refresh token both stop working.
  const cookie = await refreshCookie(context);
  if (cookie === undefined) throw new Error("no goshop_refresh cookie");
  await revokeSession(cookie.value);

  const me = page.waitForResponse(ME_URL);
  await openAccount(page);
  expect((await me).status()).toBe(401);
  await expect(page).toHaveURL("/masuk?kembali=%2Fakun");
  await expect(masukLink(page)).toBeVisible();
  await expect(greeting(page, account)).toHaveCount(0);

  // One refresh was tried, refused with TOKEN_INVALID, and it cleared the
  // cookie; nothing was retried after it.
  expect(refreshes.length - before).toBe(1);
  const refused = refreshes[before];
  expect(refused?.status()).toBe(401);
  expect(
    ((await refused?.json()) as { error: { code: string } }).error.code,
  ).toBe("TOKEN_INVALID");
  expect(await refreshCookie(context)).toBeUndefined();
  // The two 401s under test: GET /v1/me, then the refresh.
  expectOnlyStatusErrors(problems, [401, 401]);
});
