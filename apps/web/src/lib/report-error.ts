import { isApiError } from "@goshop/shared";

/**
 * Whether an error caught by an error boundary is an expected answer
 * rather than a bug: a product that is gone (NOT_FOUND) is a 404 page,
 * not a crash.
 */
const isExpected = (error: unknown): boolean => isApiError(error, "NOT_FOUND");

/**
 * Where the errors an error boundary catches go (components/layout/
 * ErrorPage.tsx, app/error.tsx). An expected error is left out,
 * everything else is logged. A real shop would also send it to an error
 * tracker here.
 */
export const reportCaughtError = (error: unknown, context?: unknown): void => {
  if (isExpected(error)) return;
  console.error(error, context);
};
