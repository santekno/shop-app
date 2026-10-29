// Dark mode (Bab 10, artikel 05): the header's "Mode gelap" toggle saves
// the viewer's choice in localStorage, and public/theme.js (a classic
// script in <head>, not inline code) applies it before <body> exists, so a
// reload never paints the light page first. The CSP stays script-src
// 'self': no inline script was needed.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems } from "../support/catalog.ts";

const toggle = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Mode gelap" });

/** The page's background colour: index.css paints it on <html>. */
const pageBackground = (page: Page): Promise<string> =>
  page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );

declare global {
  interface Window {
    /** data-theme on <html> when <body> was first seen, null when unset. */
    __goshopThemeAtBody?: string | null;
  }
}

/**
 * Records data-theme at the first mutation that shows <body>, before the
 * app's module script (which runs after parsing) can have touched it.
 */
const recordThemeAtBody = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      // document.body is typed as always there, but is null until parsed.
      if (document.querySelector("body") === null) return;
      window.__goshopThemeAtBody =
        document.documentElement.dataset.theme ?? null;
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
};

test.use({ colorScheme: "light" });

test("Mode gelap is saved and applied again before <body> on a reload, with the CSP intact", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await recordThemeAtBody(page);

  const first = await page.goto("/");
  const csp = first?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  // theme.js is a plain, render-blocking script in <head>.
  const script = page.locator('head > script[src="/theme.js"]');
  await expect(script).toHaveCount(1);
  expect(
    await script.evaluate((element) => [
      element.hasAttribute("async"),
      element.hasAttribute("defer"),
      element.getAttribute("type"),
    ]),
  ).toEqual([false, false, null]);

  // The device is light and nothing is saved: no attribute, light page.
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__goshopThemeAtBody)).toBeNull();
  const light = await pageBackground(page);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => window.localStorage.getItem("goshop:theme")),
  ).toBe("dark");
  const dark = await pageBackground(page);
  expect(dark).not.toBe(light);

  await page.reload();
  expect(await page.evaluate(() => window.__goshopThemeAtBody)).toBe("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect(await pageBackground(page)).toBe(dark);

  // And back: a choice that matches the device is not saved at all, so
  // the page follows the device again.
  await toggle(page).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(
    await page.evaluate(() => window.localStorage.getItem("goshop:theme")),
  ).toBeNull();
  await page.reload();
  expect(await page.evaluate(() => window.__goshopThemeAtBody)).toBeNull();
  expect(await pageBackground(page)).toBe(light);
  expectNoProblems(problems);
});

test("the saved theme does not wait for the app: with its JavaScript blocked the page is still dark", async ({
  page,
}) => {
  await page.goto("/");
  const light = await pageBackground(page);
  await page.evaluate(() => {
    window.localStorage.setItem("goshop:theme", "dark");
  });
  // Every hashed bundle fails to load; only theme.js (not under
  // /_next/static/) and the stylesheet run. What is dark now was made dark
  // by theme.js.
  await page.route(/\/_next\/static\/.*\.js$/, (route) => route.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The server's HTML is there (Bab 11), but Next.js never started: its
  // runtime, which sets window.next, did not load, so nothing hydrated.
  await expect(
    page.getByRole("heading", { level: 1, name: "Katalog" }),
  ).toBeVisible();
  expect(await page.evaluate(() => "next" in window)).toBe(false);
  expect(await pageBackground(page)).not.toBe(light);
});

test("on a dark device the page follows it, and a light choice is applied before <body> too", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  try {
    const problems = await watchBrowser(page);
    await recordThemeAtBody(page);
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    const followed = await pageBackground(page);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const light = await pageBackground(page);
    expect(light).not.toBe(followed);
    await page.reload();
    expect(await page.evaluate(() => window.__goshopThemeAtBody)).toBe("light");
    expect(await pageBackground(page)).toBe(light);

    await toggle(page).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await pageBackground(page)).toBe(followed);
    expectNoProblems(problems);
  } finally {
    await context.close();
  }
});
