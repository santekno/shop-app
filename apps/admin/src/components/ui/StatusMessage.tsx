import type { ReactNode } from "react";
import { errorMessage, errorRequestId } from "@/lib/error-message.ts";
import { Button } from "./Button.tsx";

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

/** Nothing to show yet, for example a queue with no orders. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
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
    <div role="alert" className="grid justify-items-start gap-2">
      <p className="text-destructive">{errorMessage(error)}</p>
      {requestId !== undefined && (
        <p className="text-sm text-muted-foreground">
          Kode permintaan: <code>{requestId}</code>
        </p>
      )}
      {onRetry !== undefined && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}
