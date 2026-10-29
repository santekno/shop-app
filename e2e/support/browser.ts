// Records what the browser complains about while a test runs: console
// errors, uncaught exceptions and Content-Security-Policy violations. A
// page that renders correctly but logs errors is still broken.
import type { Locator, Page } from "@playwright/test";

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

/**
 * The page's own alerts (role="alert"). Next.js adds one of its own to
 * every page, the route announcer (#__next-route-announcer__, which reads
 * the new title after a client navigation), so a page-wide
 * getByRole("alert") is never the app's message alone.
 */
export const pageAlerts = (page: Page): Locator =>
  page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"));

declare global {
  interface Window {
    /** Next.js' App Router, which it exposes for debugging. */
    next?: { router?: { push: (href: string) => void } };
  }
}

/**
 * Navigates inside the app, as a link would, to a URL no link on the page
 * points at: Next.js' router renders it without a reload. (Bab 7–10 did
 * this with history.pushState and a popstate event, which React Router
 * followed; Next.js' router does not.) window.next.router is the router
 * Next.js exposes for debugging, which is what a test is doing.
 */
export const clientNavigate = async (
  page: Page,
  href: string,
): Promise<void> => {
  const target = new URL(href, page.url());
  // The router's request for the page, or the page load it falls back to.
  const isFor = (url: string): boolean => {
    const requested = new URL(url);
    requested.searchParams.delete("_rsc");
    return (
      requested.origin === target.origin &&
      requested.pathname === target.pathname &&
      requested.search === target.search
    );
  };
  // A page shows its server-rendered HTML before Next.js has started, and
  // window.next.router exists a moment before the router can navigate: a
  // push that early is lost (no request, no new address), so it is
  // repeated, as a buyer clicks again. Once the router has asked the
  // server for the page, the page may take as long as the server needs.
  const settled = <T>(promise: Promise<T>): Promise<boolean> =>
    promise.then(
      () => true,
      () => false,
    );
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForFunction(() => window.next?.router !== undefined);
    const asked = settled(
      page.waitForRequest((request) => isFor(request.url()), {
        timeout: 1000,
      }),
    );
    const arrived = settled(page.waitForURL(target.href, { timeout: 1000 }));
    await page.evaluate((url) => {
      window.next?.router?.push(url);
    }, href);
    const [requested, moved] = await Promise.all([asked, arrived]);
    if (moved) return;
    if (requested) {
      await page.waitForURL(target.href, { timeout: 30_000 });
      return;
    }
  }
  throw new Error(`Next.js' router did not ask for ${href}`);
};
