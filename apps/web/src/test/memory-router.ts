// A memory router standing in for Next.js' App Router in unit tests.
//
// next/navigation's hooks (useRouter, usePathname, useSearchParams,
// useParams) and next/link need the App Router that `next dev` and
// `next start` mount; under Vitest there is none. vitest.setup.ts mocks
// both modules with this router: a history of URLs, kept in memory, that
// a test starts where it wants and reads back.
//
//   startAt("/?kategori=kaos");           // one entry
//   startAt(["/", "/produk/kaos"]);       // Back has somewhere to go
//   await user.click(link);
//   expect(currentUrl()).toBe("/produk/kaos");
//   expect(testRouter.lastAction).toBe("push");
//
// What it keeps from the real router: a link or push() adds an entry,
// replace() overwrites it, back()/forward() move through them, and every
// hook re-renders with the new URL. window.location follows the current
// entry, so code that reads window.location.hash sees the same URL. What
// it leaves out: fetching the next page's server payload (a test renders
// client components; src/test/app-tree.tsx resolves the page) and
// transitions (a navigation renders at once).
import { useMemo, useSyncExternalStore } from "react";
import type { useRouter as nextUseRouter } from "next/navigation";
import { paramsFor } from "./app-routes.ts";

type AppRouter = ReturnType<typeof nextUseRouter>;

/** What last moved the router; "start" until the test navigates. */
export type RouterAction = "start" | "push" | "replace" | "back" | "forward";

/** Any URL the browser would resolve against the page, as path + query + hash. */
const ORIGIN = "http://localhost";

let entries: string[] = ["/"];
let index = 0;
let lastAction: RouterAction = "start";
/** Counts fresh visits (push or replace to another path): bfcacheId. */
let visits = 0;
const listeners = new Set<() => void>();

/** The current entry: "/produk/kaos?x=1#a". */
export const currentEntry = (): string => entries[index] ?? "/";

const resolve = (href: string): string => {
  const url = new URL(href, ORIGIN + currentEntry());
  return url.pathname + url.search + url.hash;
};

const pathOf = (entry: string) => new URL(entry, ORIGIN).pathname;

const update = (action: RouterAction, from?: string) => {
  lastAction = action;
  if (from !== undefined && pathOf(from) !== pathOf(currentEntry())) {
    visits += 1;
  }
  // The address bar follows, without growing jsdom's own history.
  window.history.replaceState(null, "", currentEntry());
  for (const listener of listeners) listener();
};

/** Puts the router at `url`, or at the last of `urls` with the rest behind it. */
export const startAt = (url: string | string[] = "/") => {
  const list = Array.isArray(url) ? url : [url];
  entries = list.length === 0 ? ["/"] : list.map((entry) => resolve(entry));
  index = entries.length - 1;
  update("start");
};

/** The current URL without its #fragment, the way a test asserts it. */
export const currentUrl = (): string => currentEntry().replace(/#.*$/, "");

/** The App Router's methods, and what a test reads back. */
type TestRouter = AppRouter & {
  readonly lastAction: RouterAction;
  readonly entries: readonly string[];
  readonly location: { pathname: string; search: string; hash: string };
};

/**
 * The router useRouter() returns. Besides the App Router's methods it
 * tells a test which navigation happened last and what the history holds.
 */
export const testRouter = {
  push(href: string) {
    const from = currentEntry();
    entries = [...entries.slice(0, index + 1), resolve(href)];
    index = entries.length - 1;
    update("push", from);
  },
  replace(href: string) {
    const from = currentEntry();
    entries = entries.with(index, resolve(href));
    update("replace", from);
  },
  back() {
    if (index === 0) return;
    index -= 1;
    update("back");
  },
  forward() {
    if (index === entries.length - 1) return;
    index += 1;
    update("forward");
  },
  refresh() {
    // No server payload to fetch again.
  },
  prefetch() {
    // Nothing to download ahead.
  },
  get bfcacheId(): string {
    return String(visits);
  },
  get lastAction(): RouterAction {
    return lastAction;
  },
  get entries(): readonly string[] {
    return entries;
  },
  /** The current entry's parts, like window.location's. */
  get location(): { pathname: string; search: string; hash: string } {
    const { pathname, search, hash } = new URL(currentEntry(), ORIGIN);
    return { pathname, search, hash };
  },
} satisfies TestRouter;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const useEntry = () => useSyncExternalStore(subscribe, currentEntry);

export const useRouter = (): AppRouter => testRouter;

export const usePathname = (): string => pathOf(useEntry());

export const useSearchParams = (): URLSearchParams => {
  const search = new URL(useEntry(), ORIGIN).search;
  // One object per query string, like the real hook: a component may put
  // it in an effect's dependencies.
  return useMemo(() => new URLSearchParams(search), [search]);
};

/** The dynamic segments of the page the URL matches (app-routes.ts). */
export const useParams = (): Record<string, string> => {
  const pathname = usePathname();
  return useMemo(() => paramsFor(pathname) ?? {}, [pathname]);
};
