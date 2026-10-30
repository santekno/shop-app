/**
 * Where the errors a route's ErrorBoundary catches go. React and React
 * Router would each log every one (so twice); App.tsx passes this function
 * as RouterProvider's onError, and main.tsx silences React's own
 * onCaughtError, so each error is reported once, here. A real deployment
 * would also send it to an error tracker.
 *
 * Unlike the storefront, nothing is "expected" yet: no page throws on
 * purpose. Artikel 08 may add the API's 403 here.
 */
export const reportCaughtError = (error: unknown, context?: unknown): void => {
  console.error(error, context);
};
