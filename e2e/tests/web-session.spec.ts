// The web session in the browser (Bab 10, artikel 12, ADR 0008): the
// refresh token lives in the httpOnly goshop_refresh cookie and the access
// token in memory, so a reload restores the session with one POST
// /v1/auth/web/refresh; tabs share the cookie and serialise their
// refreshes with Web Locks, so reloading two at once does not trip the
// API's reuse detection; logout clears the cookie; and a guest cart is
// merged into the buyer's cart at login.
import { expect, test } from "@playwright/test";
import { registerBuyer } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import { expectOnlyStatusErrors, nav } from "../support/auth.ts";
import { watchBrowser } from "../support/browser.ts";
import { fetchProduct, openProduct } from "../support/catalog.ts";
import {
  accessTokenOf,
  greeting,
  logIn,
  logOut,
  masukLink,
  refreshCookie,
  webRefreshes,
  webStorage,
} from "../support/session.ts";
import { BROWSER_API_URL } from "../support/stack.ts";

// One account per file keeps each email under the API's 5 logins per 15
// minutes: this file logs it in four times.
let account: Account;
test.beforeAll(async () => {
  account = await registerBuyer("sesi");
});

test("a reload keeps the buyer logged in, the access token in memory and the refresh token in an httpOnly cookie", async ({
  page,
  context,
}) => {
  const problems = await watchBrowser(page);
  const refreshes = webRefreshes(page);
  await logIn(page, account);
  // The page load before the login found no cookie: 204.
  expect(refreshes.map((r) => r.status())).toEqual([204]);
  const before = await refreshCookie(context);
  expect(before).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/v1/auth/web",
  });

  await page.reload();
  await expect(greeting(page, account)).toBeVisible();
  await expect(masukLink(page)).toHaveCount(0);
  // One refresh per page load, which rotated the cookie.
  expect(refreshes.map((r) => r.status())).toEqual([204, 200]);
  const restored = refreshes[1];
  if (restored === undefined) throw new Error("no refresh after the reload");
  expect(restored.request().headers()["x-goshop-client"]).toBe("web");
  const accessToken = await accessTokenOf(restored);
  const after = await refreshCookie(context);
  expect(after?.httpOnly).toBe(true);
  expect(after?.value).not.toBe(before?.value);

  // Neither token is anywhere a script on the page could read it.
  const stored = await webStorage(page);
  expect(stored.filter((entry) => entry.includes(accessToken))).toEqual([]);
  expect(
    stored.filter(
      (entry) => after !== undefined && entry.includes(after.value),
    ),
  ).toEqual([]);
  // Nor any JWT at all, an older access token included.
  expect(
    stored.filter((entry) => /eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(entry)),
  ).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "goshop_refresh",
  );
  expectOnlyStatusErrors(problems, []);
});

test("two tabs reloaded at the same moment both stay logged in", async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const firstProblems = await watchBrowser(first);
  const secondProblems = await watchBrowser(second);
  const refreshes = webRefreshes(context);

  await logIn(first, account);
  await second.goto("/");
  await expect(greeting(second, account)).toBeVisible();

  // Both tabs send the cookie at start-up at the same time, twice. Without
  // the lock both would present the same token, the API would treat the
  // second as a stolen copy and end the session (401 for both).
  for (let round = 0; round < 2; round++) {
    await Promise.all([first.reload(), second.reload()]);
    await expect(greeting(first, account)).toBeVisible();
    await expect(greeting(second, account)).toBeVisible();
  }
  // A third tab opened afterwards is logged in too: the session is alive.
  const third = await context.newPage();
  await third.goto("/");
  await expect(greeting(third, account)).toBeVisible();

  const statuses = refreshes.map((r) => r.status());
  // 204 for the first tab's load before the login; every other is a 200.
  expect(statuses).toEqual([204, 200, 200, 200, 200, 200, 200]);
  expectOnlyStatusErrors(firstProblems, []);
  expectOnlyStatusErrors(secondProblems, []);
});

test("after logout a reload stays logged out", async ({ page, context }) => {
  const problems = await watchBrowser(page);
  const refreshes = webRefreshes(page);
  await logIn(page, account);
  await logOut(page, account);
  expect(await refreshCookie(context)).toBeUndefined();

  await page.reload();
  await expect(masukLink(page)).toBeVisible();
  await expect(greeting(page, account)).toHaveCount(0);
  // The reload finds no cookie: 204, nothing restored.
  expect(refreshes.map((r) => r.status())).toEqual([204, 204]);
  expectOnlyStatusErrors(problems, []);
});

test("a guest cart is merged into the buyer's cart at login", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  const product = await fetchProduct("kopi-arabika-gayo-250g");
  const merges: { token?: string; bearer: boolean; status?: number }[] = [];
  page.on("requestfinished", (request) => {
    if (request.url() !== `${BROWSER_API_URL}/v1/cart/merge`) return;
    void request.response().then((response) => {
      merges.push({
        token: request.headers()["x-cart-token"],
        bearer: (request.headers().authorization ?? "").startsWith("Bearer "),
        status: response?.status(),
      });
    });
  });
  const cartLink = nav(page).getByRole("link", { name: /^Keranjang/ });

  // As a guest: one item, and the guest cart's token saved.
  await page.goto("/");
  await openProduct(page, product.name);
  await page
    .getByRole("article", { name: product.name })
    .getByRole("button", { name: "Tambah ke keranjang" })
    .click();
  await expect(cartLink).toHaveAccessibleName("Keranjang 1 barang");
  // The badge can count the line a moment before the store has written
  // the new cart's token to localStorage: wait for the token, which is
  // what the merge below needs.
  const storedToken = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(window.localStorage.getItem("goshop:cart") ?? "{}") as {
            state?: { token?: string };
          }
        ).state?.token,
    );
  await expect.poll(storedToken).toBeTruthy();
  const guestToken = await storedToken();

  await page.goto("/masuk");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Kata sandi").fill(account.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(greeting(page, account)).toBeVisible();

  // One merge, with the guest token and the new access token, and the
  // header shows the buyer's cart with the guest's line in it.
  await expect
    .poll(() => merges)
    .toEqual([{ token: guestToken, bearer: true, status: 200 }]);
  await expect(cartLink).toHaveAccessibleName("Keranjang 1 barang");
  expect(
    await page.evaluate(() => window.localStorage.getItem("goshop:cart")),
  ).toBe(JSON.stringify({ state: { token: null }, version: 1 }));
  await cartLink.click();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator(".cart-line")).toContainText(product.name);

  // The buyer's cart comes from the account, so a reload still shows it.
  await page.reload();
  await expect(greeting(page, account)).toBeVisible();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  expect(merges).toHaveLength(1);
  expectOnlyStatusErrors(problems, []);
});
