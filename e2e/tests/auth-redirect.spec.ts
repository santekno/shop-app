// Protected pages and the way back (Bab 10, artikel 13): /akun sends a
// guest to /masuk?kembali=/akun (replacing the history entry) and the
// login returns there, where the page shows GET /v1/me. ?kembali= is only
// ever a path on this site: anything that would leave it, or loop back to
// an auth page, ends on the catalog.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { registerBuyer } from "../support/accounts.ts";
import type { Account } from "../support/accounts.ts";
import { expectOnlyStatusErrors } from "../support/auth.ts";
import { watchBrowser } from "../support/browser.ts";
import { greeting, submitLogin } from "../support/session.ts";
import { BROWSER_API_URL, WEB_URL } from "../support/stack.ts";

// Logged in twice by this file.
let account: Account;
test.beforeAll(async () => {
  account = await registerBuyer("kembali");
});

/** Navigates inside the app (no reload), as a link would. */
const pushPath = (page: Page, path: string): Promise<void> =>
  page.evaluate((url) => {
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);

test("/akun sends a guest to Masuk, and the login comes back to /akun", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.goto("/");
  await page.goto("/akun");
  await expect(page).toHaveURL("/masuk?kembali=%2Fakun");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Masuk");
  // replace: Back skips the protected page that only redirected.
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL("/masuk?kembali=%2Fakun");

  const me = page.waitForResponse(
    (response) =>
      response.url() === `${BROWSER_API_URL}/v1/me` &&
      response.request().method() === "GET",
  );
  await submitLogin(page, account);
  await expect(page).toHaveURL("/akun");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Akun saya");
  const response = await me;
  expect(response.status()).toBe(200);
  expect(response.request().headers().authorization).toMatch(/^Bearer ey/);
  // The profile as the API has it: registered, never verified.
  const values = page.getByRole("main").locator("dd");
  await expect(values.nth(0)).toHaveText(account.name);
  await expect(values.nth(1)).toHaveText(
    `${account.email} (belum diverifikasi)`,
  );
  expectOnlyStatusErrors(problems, []);
});

test("a ?kembali= that leaves the site, or loops to an auth page, lands on the catalog", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  // Through the form: a protocol-relative URL to another host.
  await page.goto(
    `/masuk?kembali=${encodeURIComponent("//evil.example.com/akun")}`,
  );
  await submitLogin(page, account);
  await expect(greeting(page, account)).toBeVisible();
  await expect(page).toHaveURL(`${WEB_URL}/`);

  // Logged in, /masuk sends the buyer straight to ?kembali= (checked by
  // the same rule): each attempt below is one in-app navigation.
  const attempts = [
    "https://evil.example.com/",
    "//evil.example.com",
    "/\\evil.example.com",
    "/\t/evil.example.com",
    // One leading slash, but the URL parser's normalisation (dot segments
    // removed, %2e read as a dot, "\" turned into "/") leaves the path
    // "//evil.example.com": another host, once handed back as a string.
    "/.//evil.example.com",
    "/x/..//evil.example.com/masuk",
    "/%2e//evil.example.com",
    "/./\\evil.example.com",
    "javascript:alert(1)",
    "evil.example.com",
    BROWSER_API_URL + "/v1/me",
    "/masuk",
    "/daftar?kembali=/akun",
    "/" + "a".repeat(2048),
  ];
  for (const kembali of attempts) {
    await pushPath(page, `/masuk?kembali=${encodeURIComponent(kembali)}`);
    await expect(page, `kembali=${kembali.slice(0, 40)}`).toHaveURL(
      `${WEB_URL}/`,
    );
    expect(new URL(page.url()).origin).toBe(WEB_URL);
  }
  // And a real path on the site is kept, with its query and hash.
  await pushPath(
    page,
    `/masuk?kembali=${encodeURIComponent("/keranjang?dari=e2e#ringkasan")}`,
  );
  await expect(page).toHaveURL(`${WEB_URL}/keranjang?dari=e2e#ringkasan`);
  expectOnlyStatusErrors(problems, []);
});
