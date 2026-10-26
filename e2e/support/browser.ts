// Records what the browser complains about while a test runs: console
// errors, uncaught exceptions and Content-Security-Policy violations. A
// page that renders correctly but logs errors is still broken.
import type { Page } from "@playwright/test";

/** One CSP violation, as the browser's securitypolicyviolation event reports it. */
export interface CspViolation {
  effectiveDirective: string;
  blockedURI: string;
}

export interface BrowserProblems {
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: CspViolation[];
}

declare global {
  interface Window {
    __goshopReportCsp?: (violation: CspViolation) => void;
  }
}

/**
 * Starts recording on page; call it before the first page.goto. The
 * returned object fills up as the page runs.
 */
export const watchBrowser = async (page: Page): Promise<BrowserProblems> => {
  const problems: BrowserProblems = {
    consoleErrors: [],
    pageErrors: [],
    cspViolations: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") problems.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    problems.pageErrors.push(String(error));
  });

  // The binding and the init script are installed by Playwright through
  // the DevTools protocol, not as page scripts, so the CSP under test does
  // not block them; it does block everything the page itself tries.
  await page.exposeFunction("__goshopReportCsp", (violation: CspViolation) => {
    problems.cspViolations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__goshopReportCsp?.({
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  return problems;
};
