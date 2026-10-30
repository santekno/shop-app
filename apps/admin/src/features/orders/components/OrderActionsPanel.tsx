import { useEffect, useId, useRef, useState } from "react";
import { isApiError } from "@goshop/shared";
import type { Order } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { useSessionUser } from "@/features/auth/session-context.ts";
import { useOrderAction } from "../hooks/useOrderAction.ts";
import type { OrderActionInput } from "../hooks/useOrderAction.ts";
import {
  ACTION_LABEL,
  actionDoneMessage,
  actionErrorMessage,
  actionFailure,
  orderActions,
  withheldOrderActions,
} from "../order-actions.ts";
import { ShipOrderForm } from "./ShipOrderForm.tsx";

/** The changes that ask first: both are final, and cancel is destructive. */
type ConfirmedAction = "complete" | "cancel";

/** A failure shown in the panel, as a new object each time (see below). */
interface PanelError {
  message: string;
}

/**
 * "Tindakan": what can happen to the order next, from orderActions(order,
 * role): what the status allows and the logged-in role may do (artikel
 * 08), and what just happened.
 *
 * - "Proses pesanan" (paid → processing) runs at once: it is the normal
 *   next step and changes nothing the buyer sees but the status.
 * - "Tandai dikirim" (processing → shipped) is a form: it needs the resi.
 * - "Tandai selesai" (shipped → completed) asks first: it is final, and
 *   normally the buyer confirms receipt themselves.
 * - "Batalkan pesanan" asks first, in red: final, it returns the stock
 *   and the voucher, and a paid order's money is not refunded by it.
 *   Admins only: a seller sees, instead, one sentence saying the store's
 *   admin cancels orders, under an order that could still be cancelled.
 *
 * After a change the buttons are different ones (the order moved), so
 * the focus goes to the panel's heading, and the notice under it
 * (role="status") says what happened; Tab continues to the next action.
 *
 * A failure is told in words that say what to do: someone else moved the
 * order (409: the hook has already refetched it, and the page shows its
 * new status), only an admin may cancel (403), the order is gone (404),
 * or try again (network, server). A failure in a dialog that retrying can
 * fix stays in the dialog; one that retrying cannot fix closes it and is
 * shown here, focused (role="alert"), because the dialog's button would
 * only fail again.
 */
export function OrderActionsPanel({ order }: { order: Order }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const mutation = useOrderAction(order.id);
  // Read on every render: when a refresh brings another role, the
  // buttons follow without a reload.
  const { role } = useSessionUser();
  const actions = orderActions(order, role);
  const withheld = withheldOrderActions(order, role);
  const [confirming, setConfirming] = useState<ConfirmedAction | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<PanelError | undefined>();
  // Set when a change succeeded: the focus goes to the heading once the
  // new buttons are on screen and the dialog has closed. A ref, because
  // it changes nothing on screen by itself.
  const focusHeadingNext = useRef(false);

  // A new error object each time, so a second identical failure still
  // moves the focus (the same idea as FormAlert).
  useEffect(() => {
    if (error !== undefined) alertRef.current?.focus();
  }, [error]);

  // After the render that shows the notice. A child's effects run before
  // its parent's, so the dialog has closed (and put the focus back on the
  // button that opened it, which may be gone) before this moves it.
  useEffect(() => {
    if (!focusHeadingNext.current) return;
    focusHeadingNext.current = false;
    headingRef.current?.focus();
  }, [notice]);

  /**
   * Runs one change. Resolves on success, rejects with the API's error
   * (the ship form needs it for its field).
   */
  const run = async (input: OrderActionInput) => {
    setNotice(undefined);
    setError(undefined);
    try {
      const changed = await mutation.mutateAsync(input);
      setConfirming(null);
      setNotice(actionDoneMessage(input.action, changed.code));
      focusHeadingNext.current = true;
    } catch (failure) {
      const message = actionErrorMessage(input.action, failure);
      if (confirming !== null && actionFailure(failure) === "retry") {
        setDialogError(message);
      } else if (
        // The ship form shows a field's own problem under the field.
        !(input.action === "ship" && isApiError(failure, "VALIDATION_FAILED"))
      ) {
        setConfirming(null);
        setError({ message });
      }
      throw failure;
    }
  };

  const ask = (action: ConfirmedAction) => {
    setDialogError(undefined);
    setConfirming(action);
  };

  const paid = order.paid_at !== null;

  return (
    <Card as="section" labelledBy={headingId} className="print:hidden">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="mb-3">
        Tindakan
      </h2>

      <p role="status" className="mb-3 empty:hidden">
        {notice}
      </p>
      {error !== undefined && (
        <p
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="mb-3 text-destructive"
        >
          {error.message}
        </p>
      )}

      {actions.length === 0 && (
        <p className="text-muted-foreground">
          {order.status === "pending_payment"
            ? "Menunggu pembeli membayar."
            : "Tidak ada tindakan lagi untuk pesanan ini."}
        </p>
      )}

      {actions.includes("ship") && (
        <div className="mb-4">
          <ShipOrderForm
            order={order}
            pending={mutation.isPending}
            onShip={(body) => run({ action: "ship", body })}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.includes("process") && (
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              run({ action: "process" }).catch(() => undefined);
            }}
          >
            {mutation.isPending && mutation.variables.action === "process"
              ? "Memproses…"
              : ACTION_LABEL.process}
          </Button>
        )}
        {actions.includes("complete") && (
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              ask("complete");
            }}
          >
            {ACTION_LABEL.complete}
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              ask("cancel");
            }}
          >
            {ACTION_LABEL.cancel}
          </Button>
        )}
      </div>

      {withheld.includes("cancel") && (
        <p className="mt-3 text-sm text-muted-foreground">
          Pembatalan pesanan dilakukan oleh admin toko. Jika pesanan ini perlu
          dibatalkan, hubungi admin.
        </p>
      )}

      <ConfirmDialog
        open={confirming === "complete"}
        title={`Tandai pesanan ${order.code} selesai?`}
        confirmLabel={ACTION_LABEL.complete}
        pending={mutation.isPending}
        error={dialogError}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          run({ action: "complete" }).catch(() => undefined);
        }}
      >
        <p>
          Lakukan ini setelah paket sampai, misalnya setelah pembeli
          mengonfirmasi lewat telepon. Biasanya pembeli menandainya sendiri.
        </p>
        <p>Pesanan yang selesai tidak dapat diubah lagi.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "cancel"}
        title={`Batalkan pesanan ${order.code}?`}
        confirmLabel={ACTION_LABEL.cancel}
        cancelLabel="Jangan batalkan"
        destructive
        pending={mutation.isPending}
        error={dialogError}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          run({ action: "cancel" }).catch(() => undefined);
        }}
      >
        <p>
          Stok barangnya kembali tersedia dan voucher yang dipakai dapat
          digunakan lagi. Pembatalan tidak dapat diurungkan.
        </p>
        {paid && (
          <p>
            Pesanan ini sudah dibayar: uang pembeli tidak dikembalikan otomatis.
            Kembalikan lewat dasbor Midtrans.
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}
