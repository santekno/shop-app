import type { ReactNode } from "react";
import { errorMessage, errorRequestId } from "@/lib/error-message.ts";

/**
 * The three states every piece of loaded data can be in besides "here it
 * is". A page picks one with ordinary JavaScript:
 *
 *   {state.status === "loading" && <LoadingState>Memuat…</LoadingState>}
 *
 * `cond && <X />` renders X when cond is true and nothing when it is false.
 * Use a real boolean: with a number, `items.length && <X />` renders a
 * literal "0" when the list is empty. Compare instead: `items.length > 0`.
 */

/** "Loading …", announced politely to screen readers (role="status"). */
export function LoadingState({ children }: { children: ReactNode }) {
  return <p role="status">{children}</p>;
}

/** Nothing to show yet, for example a catalog with no products. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

interface ErrorStateProps {
  error: unknown;
  /** Shows a "Coba lagi" button that calls it. */
  onRetry?: () => void;
}

/**
 * What went wrong, in Indonesian, with the request ID to quote and a retry
 * button. role="alert" makes screen readers announce it at once.
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const requestId = errorRequestId(error);
  return (
    <div role="alert" className="error">
      <p>{errorMessage(error)}</p>
      {requestId !== undefined && (
        <p className="muted">
          Kode permintaan: <code>{requestId}</code>
        </p>
      )}
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}
