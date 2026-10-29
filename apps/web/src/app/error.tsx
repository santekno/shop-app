"use client";

import { ErrorPage } from "@/components/layout/ErrorPage.tsx";

/**
 * The error boundary around every page (inside the root layout, so the
 * header stays). An error boundary is a client component: it must catch
 * errors thrown in the browser too.
 */
export default function ErrorBoundary({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return <ErrorPage error={error} />;
}
