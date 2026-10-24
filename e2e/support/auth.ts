// Helpers for the login and register specs.
import { expect } from "@playwright/test";
import type { Locator, Page, Request } from "@playwright/test";
import type { BrowserProblems } from "./browser.ts";
import { BROWSER_API_URL } from "./stack.ts";

/** The POSTs the page sends to an auth endpoint, e.g. "register". */
export const authPosts = (page: Page, endpoint: string): Request[] => {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url() === `${BROWSER_API_URL}/v1/auth/${endpoint}`
    ) {
      requests.push(request);
    }
  });
  return requests;
};

/**
 * Fails on any console error but the failed resource loads with these
 * statuses (the API's answers under test), on any page error, and on any
 * CSP violation, as the other UI specs do.
 */
export const expectOnlyStatusErrors = (
  problems: BrowserProblems,
  statuses: readonly number[],
): void => {
  const expected = statuses.map(
    (status) =>
      `Failed to load resource: the server responded with a status of ${status}`,
  );
  const seen = problems.consoleErrors.map(
    (text) => expected.find((prefix) => text.startsWith(prefix)) ?? text,
  );
  expect(seen).toEqual(expected);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
};

/** The error text an input points at through aria-describedby. */
const describedError = (input: Locator): Promise<string> =>
  input.evaluate((element) =>
    (element.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((target) => target?.classList.contains("field__error"))
      .map((target) => target?.textContent ?? "")
      .join(" "),
  );

export const expectFieldError = async (input: Locator, message: string) => {
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => describedError(input)).toBe(message);
};

export const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Utama" });
