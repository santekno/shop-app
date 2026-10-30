import type { UIMatch } from "react-router";

/**
 * What a route may say about itself in its `handle` (routes.tsx). React
 * Router keeps a route's handle as it is and hands it back with each
 * match (useMatches), so the route table is the one place that names a
 * page.
 */
export interface RouteHandle {
  /** The page's name in the breadcrumb. A route without one adds none. */
  crumb?: string;
}

/** One step of the breadcrumb. */
export interface Crumb {
  label: string;
  /** The path of the route that named it. */
  to: string;
}

/** `handle` is `unknown` to React Router: checked, not cast. */
const crumbOf = (handle: unknown): string | undefined =>
  typeof handle === "object" &&
  handle !== null &&
  "crumb" in handle &&
  typeof handle.crumb === "string" &&
  handle.crumb !== ""
    ? handle.crumb
    : undefined;

/**
 * The breadcrumb for the matched routes, outermost first: one step per
 * route whose handle has a `crumb`. useMatches lists the routes from the
 * root down to the page, so "/produk" gives the dashboard layout's
 * "Dasbor", then the products route's "Produk". The last step is the page
 * on screen.
 */
export const breadcrumbsFrom = (
  matches: readonly Pick<UIMatch, "handle" | "pathname">[],
): Crumb[] =>
  matches.flatMap((match) => {
    const label = crumbOf(match.handle);
    return label === undefined ? [] : [{ label, to: match.pathname }];
  });
