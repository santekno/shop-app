// The storefront's pages, nested the way Next.js nests them, for tests that
// render the whole app at a URL (render.tsx: renderApp).
//
// Next.js builds the tree from src/app: for the page a URL matches, each
// folder from src/app down contributes its layout.tsx, then an error
// boundary with its error.tsx, then a 404 boundary with its not-found.tsx,
// then the next folder; the page sits at the bottom. A URL no page matches
// gets the root not-found.tsx. This file builds the same tree from the
// same files, so a test of /checkout runs app/(akun)/layout.tsx (the login
// check) and the page.tsx Next.js would run.
//
// Two differences, both because a test renders in a browser-like DOM
// only:
//
// - The root layout (<html>, <head>, the providers) is not rendered; the
//   tests put their own providers and SiteFrame around this tree.
// - A server page (an async component, which fetches on the server) cannot
//   render here. It gets a stand-in: the client component it renders, which
//   reads the same data from the (fake) API. A new server page without one
//   fails loudly below.
import { Component } from "react";
import type { ComponentType, ReactNode } from "react";
import { CatalogPage } from "@/features/catalog/components/CatalogPage.tsx";
import { ProductDetailPage } from "@/features/product/components/ProductDetailPage.tsx";
import { routeFor } from "./app-routes.ts";
import { usePathname } from "./memory-router.ts";

type Params = Record<string, string>;
interface Module<P> {
  default: ComponentType<P>;
}

// Eager: every page and layout module, loaded with the test file. The
// root layout is left out (above).
const pages = import.meta.glob<Module<object>>("../app/**/page.tsx", {
  eager: true,
});
const layouts = import.meta.glob<Module<{ children: ReactNode }>>(
  ["../app/**/layout.tsx", "!../app/layout.tsx"],
  { eager: true },
);
const notFounds = import.meta.glob<Module<object>>("../app/**/not-found.tsx", {
  eager: true,
});
const errorPages = import.meta.glob<Module<{ error: Error }>>(
  "../app/**/error.tsx",
  { eager: true },
);

/** The client components the server pages render, by URL pattern. */
const serverPageStandIns: Record<string, (params: Params) => ReactNode> = {
  "/": () => <CatalogPage />,
  "/produk/[slug]": ({ slug = "" }) => <ProductDetailPage slug={slug} />,
};

const isAsync = (component: unknown) =>
  typeof component === "function" &&
  component.constructor.name === "AsyncFunction";

/** notFound() from next/navigation throws an error with this digest. */
const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  typeof error.digest === "string" &&
  error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");

/** redirect() and notFound() are control flow, not errors: never caught by error.tsx. */
const isNextControlFlow = (error: unknown) =>
  isNotFound(error) ||
  (typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT"));

interface BoundaryProps {
  /** A new path resets the boundary, as Next.js does on navigation. */
  pathname: string;
  children: ReactNode;
}

interface BoundaryState {
  error: unknown;
  pathname: string;
}

class NotFoundBoundary extends Component<
  BoundaryProps & { fallback: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { error: undefined, pathname: "" };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    if (!isNotFound(error)) throw error;
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.pathname === state.pathname) return null;
    return { error: undefined, pathname: props.pathname };
  }

  override render() {
    return this.state.error === undefined
      ? this.props.children
      : this.props.fallback;
  }
}

class ErrorBoundary extends Component<
  BoundaryProps & { Fallback: ComponentType<{ error: Error }> },
  BoundaryState
> {
  override state: BoundaryState = { error: undefined, pathname: "" };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    if (isNextControlFlow(error)) throw error;
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (props.pathname === state.pathname) return null;
    return { error: undefined, pathname: props.pathname };
  }

  override render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    const { Fallback } = this.props;
    return (
      <Fallback
        error={
          error instanceof Error
            ? error
            : new Error("A non-Error was thrown", { cause: error })
        }
      />
    );
  }
}

/** The key a glob gave a file in `folders` ("../app/(akun)/layout.tsx"). */
const fileIn = (folders: string[], name: string) =>
  ["..", "app", ...folders, name].join("/");

/** Wraps `node` in what `folders`' own folder contributes, innermost first. */
const wrapFolder = (
  node: ReactNode,
  folders: string[],
  pathname: string,
): ReactNode => {
  let wrapped = node;
  const NotFound = notFounds[fileIn(folders, "not-found.tsx")]?.default;
  if (NotFound !== undefined) {
    wrapped = (
      <NotFoundBoundary pathname={pathname} fallback={<NotFound />}>
        {wrapped}
      </NotFoundBoundary>
    );
  }
  const ErrorPage = errorPages[fileIn(folders, "error.tsx")]?.default;
  if (ErrorPage !== undefined) {
    wrapped = (
      <ErrorBoundary pathname={pathname} Fallback={ErrorPage}>
        {wrapped}
      </ErrorBoundary>
    );
  }
  // The root folder's layout is the root layout, which tests replace.
  const Layout =
    folders.length === 0
      ? undefined
      : layouts[fileIn(folders, "layout.tsx")]?.default;
  return Layout === undefined ? wrapped : <Layout>{wrapped}</Layout>;
};

const pageElement = (file: string, pattern: string, params: Params) => {
  const standIn = serverPageStandIns[pattern];
  if (standIn !== undefined) return standIn(params);
  const Page = pages[file]?.default;
  if (Page === undefined) throw new Error(`${file} has no default export`);
  if (isAsync(Page)) {
    throw new Error(
      `${file} is a server page: give it a client stand-in in src/test/app-tree.tsx`,
    );
  }
  return <Page />;
};

/**
 * The page at the memory router's URL, inside its layouts and boundaries.
 * Renders again on every navigation, like the App Router's tree.
 */
export function AppPages() {
  const pathname = usePathname();
  const match = routeFor(pathname);
  if (match === undefined) {
    const RootNotFound = notFounds["../app/not-found.tsx"]?.default;
    if (RootNotFound === undefined)
      throw new Error("app/not-found.tsx is missing");
    // An unmatched URL: the root not-found.tsx, inside the root boundaries.
    return wrapFolder(<RootNotFound />, [], pathname);
  }
  const { route, params } = match;
  let node: ReactNode = pageElement(route.file, route.pattern, params);
  for (let depth = route.folders.length; depth >= 0; depth -= 1) {
    node = wrapFolder(node, route.folders.slice(0, depth), pathname);
  }
  return node;
}
