// Analytics, opt-in, behind a consent banner (Bab 11 artikel 13).
//
// - The stack's storefront runs with GA_MEASUREMENT_ID empty: no Google
//   script, no banner, no gtag, no request to Google.
// - A second container of the same image runs with an ID (it is read when
//   the server starts) and is served to the browser under the stack's own
//   origin, so CORS and the CSP are the real ones. Consent Mode v2 starts
//   denied; "Tolak" keeps it denied, "Izinkan" grants analytics_storage;
//   both are remembered.
//
// No request ever reaches Google: every request to a Google host is
// intercepted. gtag.js is answered with a stand-in that sends nothing, so
// the tests check what the storefront itself does (the scripts it loads,
// the commands it queues in dataLayer, what it stores), not Google's
// library. The storefront uses Consent Mode's advanced mode on purpose
// (docs/web/README.md, artikel 13): gtag.js loads for every visitor and,
// before consent or after "Tolak", Google's own library may send
// cookieless pings; that part is Google's code and is not exercised here.
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems, productCards } from "../support/catalog.ts";
import { SITE_URL, compose, stackImageOrigin } from "../support/stack.ts";
import { serveFrom, startWebInstance } from "../support/web-instance.ts";
import type { WebInstance } from "../support/web-instance.ts";

// A page whose HTML Playwright hands over (serveFrom, below) has no
// network address of its own, so Chromium's Local Network Access treats it
// as a public site and blocks its calls to the API on localhost. Served by
// the stack itself the page is on localhost too and nothing is blocked; the
// check is the harness's problem, not the storefront's. (A launch option,
// so it can only be set for the whole file.)
test.use({
  launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
});

/** A GA4-shaped ID for the second container; it names no real property. */
const MEASUREMENT_ID = "G-E2ECONSENT1";

const GTAG_URL = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;

/** The hosts Google's tag talks to. */
const GOOGLE =
  /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|google\.com|doubleclick\.net)\//;

const CONSENT_KEY = "goshop:analytics-consent";

/**
 * Intercepts every request to Google: gtag.js gets a stand-in script
 * (which only marks that it ran), anything else is aborted. Returns the
 * URLs the browser asked for.
 */
const blockGoogle = async (context: BrowserContext): Promise<string[]> => {
  const requested: string[] = [];
  await context.route(GOOGLE, async (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.startsWith("https://www.googletagmanager.com/gtag/js")) {
      await route.fulfill({
        contentType: "text/javascript",
        body: "window.__gtagStandIn = true;",
      });
    } else {
      await route.abort("blockedbyclient");
    }
  });
  return requested;
};

declare global {
  interface Window {
    dataLayer?: IArguments[];
    gtag?: unknown;
    __gtagStandIn?: boolean;
  }
}

/** dataLayer's entries as plain arrays (gtag() pushes its arguments). */
const dataLayer = (page: Page): Promise<unknown[][]> =>
  page.evaluate(() =>
    (window.dataLayer ?? []).map((entry) => Array.from(entry) as unknown[]),
  );

/** The consent commands in dataLayer, in order. */
const consentCommands = async (page: Page): Promise<unknown[][]> =>
  (await dataLayer(page)).filter((entry) => entry[0] === "consent");

const DENIED_DEFAULT = [
  "consent",
  "default",
  {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  },
];

const banner = (page: Page) =>
  page.getByRole("region", { name: "Izinkan analytics?" });

const settingsButton = (page: Page) =>
  page.getByRole("button", { name: "Pengaturan analytics" });

const storedConsent = (page: Page): Promise<string | null> =>
  page.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY);

test("with GA_MEASUREMENT_ID empty there is no banner, no gtag and no request to Google", async ({
  page,
  context,
}) => {
  expect(
    compose("exec", "-T", "web", "printenv", "GA_MEASUREMENT_ID").trim(),
  ).toBe("");
  const problems = await watchBrowser(page);
  const google = await blockGoogle(context);

  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).not.toMatch(/google/);
  expect(await response?.text()).not.toContain("googletagmanager");
  await expect(productCards(page).first()).toBeVisible();
  // A product, reached the way a buyer gets there.
  await productCards(page)
    .first()
    .locator(".product-card__name")
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/produk\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await expect(banner(page)).toHaveCount(0);
  await expect(settingsButton(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => [typeof window.gtag, typeof window.dataLayer]),
  ).toEqual(["undefined", "undefined"]);
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("goshop:analytics"),
      ),
    ),
  ).toEqual([]);
  expect(google).toEqual([]);
  expectNoProblems(problems);
});

test.describe("with GA_MEASUREMENT_ID set", () => {
  let instance: WebInstance;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
    instance = await startWebInstance({
      SITE_URL,
      IMAGE_ORIGIN: stackImageOrigin(),
      GA_MEASUREMENT_ID: MEASUREMENT_ID,
    });
  });

  // Next.js prefetches links in the background; one may still be on its
  // way through serveFrom when a test ends, and is not part of it.
  test.afterEach(async ({ context }) => {
    await context.unrouteAll({ behavior: "ignoreErrors" });
  });

  test.afterAll(() => {
    instance.stop();
  });

  test("a first visit shows the banner without taking the focus, starts Consent Mode denied, and loads gtag.js with the page's nonce", async ({
    page,
    context,
  }) => {
    const problems = await watchBrowser(page);
    const google = await blockGoogle(context);
    await serveFrom(context, instance);

    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(
      /script-src 'self' 'nonce-[^']+' https:\/\/\*\.googletagmanager\.com;/,
    );
    await expect(productCards(page).first()).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText("tanpa nama, email, atau alamat");
    await expect(
      banner(page).getByRole("button", { name: "Izinkan" }),
    ).toBeVisible();
    await expect(
      banner(page).getByRole("button", { name: "Tolak" }),
    ).toBeVisible();
    // It appeared by itself: the focus stays where it was.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      "BODY",
    );

    // Consent's default comes first, before js and config.
    const entries = await dataLayer(page);
    expect(entries[0]).toEqual(DENIED_DEFAULT);
    expect(entries[1]?.[0]).toBe("js");
    expect(entries[2]).toEqual(["config", MEASUREMENT_ID]);
    // The catalog's first page as one list view, with no personal data.
    const lists = entries.filter(
      (entry) => entry[0] === "event" && entry[1] === "view_item_list",
    );
    expect(lists).toHaveLength(1);
    expect(lists[0]?.[2]).toMatchObject({
      item_list_id: "katalog",
      item_list_name: "Katalog",
    });

    // gtag.js was asked for, ran, and carries the nonce the init script has.
    await expect
      .poll(() => page.evaluate(() => window.__gtagStandIn))
      .toBe(true);
    const nonces = await page.evaluate(() => [
      (document.getElementById("gtag-init") as HTMLScriptElement | null)?.nonce,
      document.querySelector<HTMLScriptElement>(
        'script[src^="https://www.googletagmanager.com/gtag/js"]',
      )?.nonce,
    ]);
    expect(nonces[0]).toBeTruthy();
    expect(nonces[1]).toBe(nonces[0]);
    // The storefront itself asks Google for the script and nothing else.
    expect(google).toEqual([GTAG_URL]);
    expect(await storedConsent(page)).toBeNull();
    expectNoProblems(problems);
  });

  test("'Tolak' keeps analytics denied, is remembered, and the storefront sends Google nothing but the script", async ({
    page,
    context,
  }) => {
    const problems = await watchBrowser(page);
    const google = await blockGoogle(context);
    await serveFrom(context, instance);

    await page.goto("/");
    await banner(page).getByRole("button", { name: "Tolak" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([
      DENIED_DEFAULT,
      ["consent", "update", { analytics_storage: "denied" }],
    ]);
    expect(await storedConsent(page)).toBe("denied");

    // Remembered: after a reload no banner, and the default is denied.
    await page.reload();
    await expect(productCards(page).first()).toBeVisible();
    await expect(settingsButton(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([DENIED_DEFAULT]);
    expect(google.every((url) => url === GTAG_URL)).toBe(true);
    expectNoProblems(problems);
  });

  test("'Izinkan' grants analytics_storage, is remembered, and 'Pengaturan analytics' reopens the banner with the focus", async ({
    page,
    context,
  }) => {
    const problems = await watchBrowser(page);
    await blockGoogle(context);
    await serveFrom(context, instance);

    await page.goto("/");
    await banner(page).getByRole("button", { name: "Izinkan" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([
      DENIED_DEFAULT,
      ["consent", "update", { analytics_storage: "granted" }],
    ]);
    expect(await storedConsent(page)).toBe("granted");

    // After a reload the default itself is granted (the init script reads
    // the answer before config), with no banner.
    await page.reload();
    await expect(productCards(page).first()).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([
      [
        "consent",
        "default",
        {
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
          analytics_storage: "granted",
        },
      ],
    ]);

    // Changing it later: the footer's button opens the banner, focused,
    // with the current answer; Esc closes it and gives the focus back.
    await settingsButton(page).click();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toBeFocused();
    await expect(banner(page)).toContainText("diizinkan");
    await page.keyboard.press("Escape");
    await expect(banner(page)).toHaveCount(0);
    await expect(settingsButton(page)).toBeFocused();
    expect(await storedConsent(page)).toBe("granted");
    expectNoProblems(problems);
  });
});
