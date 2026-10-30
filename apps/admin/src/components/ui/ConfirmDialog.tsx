import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";

interface ConfirmDialogProps {
  /** Whether the dialog is on screen. The caller owns this state. */
  open: boolean;
  title: string;
  /** What will happen, and what will not. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button in the destructive colour (archiving, leaving). */
  destructive?: boolean;
  /** While the confirmed action runs: buttons disabled, Escape ignored. */
  pending?: boolean;
  /** Why the confirmed action failed, shown in the dialog. */
  error?: string | undefined;
  onConfirm: () => void;
  /** "Batal", Escape, or the browser closing the dialog. */
  onCancel: () => void;
}

/**
 * A modal question with two answers, on the browser's own <dialog>
 * element (shadcn/ui's AlertDialog look, not its Radix implementation).
 *
 * Why native: `showModal()` gives everything a modal needs, with no
 * JavaScript of ours: the page behind becomes inert (no click, no Tab, no
 * screen reader reaches it), the dialog sits in the top layer above
 * everything, Escape cancels it, and the focus returns to where it was
 * when it closes. Radix's Dialog does the same in JavaScript and locks the
 * page's scroll by inserting a <style> element, which the dashboard's CSP
 * (`style-src 'self'`) refuses (README, artikel 01).
 *
 * role="alertdialog": a question that interrupts, so a screen reader reads
 * the title and the description (aria-labelledby, aria-describedby) as
 * soon as it opens. The focus starts on the cancel button: Enter on a
 * dialog that just appeared should never archive anything.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Batal",
  destructive = false,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // `open` is React's; showModal()/close() are the DOM's. The effect keeps
  // the element in step with the prop (what effects are for).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/50"
      onCancel={(event) => {
        // Escape: the caller decides (it may be busy), and then closes us.
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClose={() => {
        // Closed by the browser itself (a second Escape): tell the caller.
        if (open) onCancel();
      }}
    >
      <h2 id={titleId} className="mb-2 text-lg">
        {title}
      </h2>
      <div id={descriptionId} className="grid gap-2 text-muted-foreground">
        {children}
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          ref={cancelRef}
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Memproses…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
