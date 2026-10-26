// The Content-Security-Policy is enforced, not just sent: the browser
// refuses an injected inline script and a call to an API the image was not
// built for. (The storefront specs check the other side: the app itself
// causes no violation.)
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";

declare global {
  interface Window {
    __goshopInlineRan?: boolean;
  }
}

test("the CSP blocks inline scripts and calls to other origins", async ({
  page,
}) => {
  const problems = await watchBrowser(page);
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Kategori" }).getByRole("list").first(),
  ).toBeVisible();
  expect(problems.cspViolations).toEqual([]);

  // What an XSS would try: run inline code. script-src 'self' forbids it.
  const inlineRan = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__goshopInlineRan = true;";
    document.head.append(script);
    return window.__goshopInlineRan === true;
  });
  expect(inlineRan).toBe(false);

  // ...or send data somewhere else. connect-src allows only the page and
  // the API, so fetch fails before any request leaves the browser.
  const fetchError = await page.evaluate(async () => {
    try {
      await fetch("http://127.0.0.1:9/steal");
      return "";
    } catch (error) {
      return String(error);
    }
  });
  expect(fetchError).toContain("TypeError");

  await expect
    .poll(() => problems.cspViolations.map((v) => v.effectiveDirective).sort())
    .toEqual(["connect-src", "script-src-elem"]);
  expect(problems.cspViolations).toContainEqual({
    effectiveDirective: "connect-src",
    blockedURI: "http://127.0.0.1:9/steal",
  });
  expect(problems.pageErrors).toEqual([]);
});
