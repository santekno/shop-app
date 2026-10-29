// The storefront's pages as Next.js finds them: every src/app/**/page.tsx,
// read from the folder itself, so a page added, moved or deleted changes
// what the tests route to without a list to keep in step.
//
// A folder is one URL segment, except a route group "(akun)", which adds
// nothing to the URL, and "[slug]", which matches any one segment and
// hands it to the page as a parameter.

/** One page: its folder's segments ("(akun)", "pesanan", "[id]"), from src/app. */
export interface AppRoute {
  /** The page.tsx key the glob gave it, for loading the module. */
  file: string;
  /** Every folder from src/app down to the page's own, groups included. */
  folders: string[];
  /** The URL pattern, Next.js style: "/pesanan/[id]/pembayaran". */
  pattern: string;
}

const APP_PREFIX = "../app/";

const isGroup = (folder: string) => folder.startsWith("(");
const paramName = (folder: string) =>
  /^\[([^.\]]+)\]$/.exec(folder)?.[1] ?? undefined;

const toRoute = (file: string): AppRoute => {
  const folders = file.slice(APP_PREFIX.length).split("/").slice(0, -1);
  const segments = folders.filter((folder) => !isGroup(folder));
  return { file, folders, pattern: `/${segments.join("/")}` };
};

/** Only the file names: the modules themselves load in app-tree.tsx. */
export const appRoutes: AppRoute[] = Object.keys(
  import.meta.glob("../app/**/page.tsx"),
).map(toRoute);

/** Splits a pathname into its segments: "/a/b" → ["a", "b"], "/" → []. */
const segmentsOf = (path: string) => path.split("/").filter((s) => s !== "");

/**
 * The parameters `pattern` ("/produk/[slug]") takes from `pathname`, or
 * undefined when it does not match.
 */
export const matchPattern = (
  pattern: string,
  pathname: string,
): Record<string, string> | undefined => {
  const wanted = segmentsOf(pattern);
  const actual = segmentsOf(pathname);
  if (wanted.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, segment] of wanted.entries()) {
    const value = actual[i] ?? "";
    const name = paramName(segment);
    if (name === undefined) {
      if (segment !== value) return undefined;
      continue;
    }
    try {
      params[name] = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return params;
};

/** Fewer parameters first: /produk/baru beats /produk/[slug], as in Next.js. */
const dynamicCount = (route: AppRoute) =>
  route.folders.filter((folder) => paramName(folder) !== undefined).length;

/** The page `pathname` opens, with its parameters, or undefined (a 404). */
export const routeFor = (
  pathname: string,
): { route: AppRoute; params: Record<string, string> } | undefined => {
  const ranked = [...appRoutes].sort(
    (a, b) => dynamicCount(a) - dynamicCount(b),
  );
  for (const route of ranked) {
    const params = matchPattern(route.pattern, pathname);
    if (params !== undefined) return { route, params };
  }
  return undefined;
};

/** useParams() for `pathname`: the matched page's parameters. */
export const paramsFor = (pathname: string) => routeFor(pathname)?.params;
