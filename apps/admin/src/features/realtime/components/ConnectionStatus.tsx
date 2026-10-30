import { Button } from "@/components/ui/Button.tsx";
import { cn } from "@/lib/utils.ts";
import type { ConnectionStatus as Status } from "../connection.ts";
import { useOrderEventsContext } from "../order-events-context.ts";

type Tone = "live" | "pending" | "down";

interface StatusView {
  label: string;
  /** One sentence: what it means for the seller. */
  detail: string;
  tone: Tone;
  /** Whether "Coba lagi" helps (the connection is waiting to retry). */
  canRetry: boolean;
}

const VIEWS: Record<Status, StatusView> = {
  connecting: {
    label: "Menyambung…",
    detail: "Membuka notifikasi pesanan.",
    tone: "pending",
    canRetry: false,
  },
  live: {
    label: "Langsung",
    detail: "Pesanan baru muncul di sini begitu dibayar.",
    tone: "live",
    canRetry: false,
  },
  reconnecting: {
    label: "Menyambung ulang…",
    detail: "Notifikasi pesanan terputus sebentar dan sedang disambung lagi.",
    tone: "pending",
    canRetry: false,
  },
  unreachable: {
    label: "Terputus",
    detail:
      "Notifikasi pesanan tidak dapat dihubungi. Dasbor mencoba lagi otomatis.",
    tone: "down",
    canRetry: true,
  },
  "too-many-streams": {
    label: "Terputus",
    detail:
      "Terlalu banyak tab dasbor terbuka untuk akun ini. Tutup salah satunya; dasbor mencoba lagi otomatis.",
    tone: "down",
    canRetry: true,
  },
  forbidden: {
    label: "Terputus",
    detail: "Akun ini tidak boleh menerima notifikasi pesanan.",
    tone: "down",
    canRetry: false,
  },
  ended: {
    label: "Terputus",
    detail: "Sesi berakhir. Masuk lagi untuk menerima notifikasi pesanan.",
    tone: "down",
    canRetry: false,
  },
};

const DOT: Record<Tone, string> = {
  live: "bg-success",
  pending: "bg-muted-foreground motion-safe:animate-pulse",
  down: "bg-destructive",
};

/**
 * The header's small "is the live feed on?" sign: a dot and a word,
 * "Langsung", "Menyambung ulang…" or "Terputus". The word carries the
 * meaning; the dot's colour only repeats it. A screen reader hears
 * "Notifikasi pesanan: Terputus" and, when it is down, why.
 *
 * Not a live region: a stream that blinks while reconnecting would
 * interrupt whatever the user is listening to, and nothing is lost while
 * it does (the queue refetches on reconnect).
 */
export function ConnectionStatus() {
  const { status, retryNow } = useOrderEventsContext();
  const view = VIEWS[status];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <p className="flex items-center gap-1.5" title={view.detail}>
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", DOT[view.tone])}
        />
        <span className="sr-only">Notifikasi pesanan: </span>
        <span className={cn(view.tone === "down" && "text-destructive")}>
          {view.label}
        </span>
        {view.tone === "down" && (
          <span className="sr-only">. {view.detail}</span>
        )}
      </p>
      {view.canRetry && (
        <Button variant="link" size="sm" className="text-xs" onClick={retryNow}>
          Coba lagi
          <span className="sr-only"> menyambung notifikasi</span>
        </Button>
      )}
    </div>
  );
}
