import { isApiError } from "@goshop/shared";

/**
 * Whether an error caught by an error boundary is an expected answer
 * rather than a bug: the product page throws NOT_FOUND on purpose, so
 * RouteErrorPage can show the 404 page.
 */
const isExpected = (error: unknown): boolean => isApiError(error, "NOT_FOUND");

/**
 * Where the errors a route's ErrorBoundary catches go. By default React
 * and React Router each log every one with console.error (so twice), the
 * expected NOT_FOUND included, and a buyer opening an old product link
 * would look like a crash in the console (and in any error tracker reading
 * it). App.tsx passes this function as RouterProvider's onError, and
 * main.tsx silences React's own onCaughtError: each error is reported
 * once, here. An expected error is left out, everything else is logged.
 * A real shop would also send it to an error tracker here.
 */
export const reportCaughtError = (error: unknown, context?: unknown): void => {
  if (isExpected(error)) return;
  console.error(error, context);
};
