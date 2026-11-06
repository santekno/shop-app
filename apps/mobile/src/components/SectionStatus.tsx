import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StatusMessage";
import type { QueryView } from "@/lib/query-state";

interface SectionStatusProps {
  /** Which of the non-data states the section is in (queryView). */
  view: Exclude<QueryView, "ready">;
  /** What is loading, for the spinner and the screen reader: "banner". */
  what: string;
  error: unknown;
  onRetry: () => void;
}

/**
 * The three states a home section has besides its data, in the app's
 * words: loading, waiting for the network, failed (with "Coba lagi").
 * Each section owns its own, so one failing request leaves the other two
 * sections working instead of replacing the whole screen with an error.
 */
export function SectionStatus({
  view,
  what,
  error,
  onRetry,
}: SectionStatusProps) {
  switch (view) {
    case "loading":
      return <LoadingState label={`Memuat ${what}…`} />;
    case "offline":
      return (
        <EmptyState
          message={`Tidak ada koneksi internet. ${capitalise(what)} dimuat begitu koneksi kembali.`}
        />
      );
    case "error":
      return <ErrorState error={error} onRetry={onRetry} />;
  }
}

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
