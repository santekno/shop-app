// The skip link (Bab 10, artikel 07): the first Tab stop on every page,
// hidden until it has the focus, and Enter moves the focus to <main>
// without adding a history entry, so the next Tab starts in the page's
// content instead of walking the header again.
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import { expectNoProblems } from "../support/catalog.ts";

for (const path of ["/", "/keranjang", "/masuk"]) {
  test(`on ${path} the first Tab reaches the skip link, and Enter puts the focus on <main>`, async ({
    page,
  }) => {
    const problems = await watchBrowser(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const skip = page.getByRole("link", { name: "Langsung ke konten utama" });

    // Off screen while the focus is elsewhere.
    const box = await skip.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(0);

    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await expect(skip).toHaveAttribute("href", "#konten");

    const historyLength = await page.evaluate(() => window.history.length);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await expect(page).toHaveURL(path);
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength,
    );

    // The next Tab goes into the content, not back to the header.
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(() =>
      document.querySelector("main")?.contains(document.activeElement),
    );
    expect(inMain).toBe(true);
    expectNoProblems(problems);
  });
}
