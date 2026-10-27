import { useId, useMemo } from "react";
import { checkoutProblems } from "@goshop/shared";
import type { CartLine } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { checkoutErrorMessage } from "../checkout-errors.ts";
import { CheckoutProblemList } from "./CheckoutProblemList.tsx";

interface PlaceOrderProps {
  /** Why the order cannot be placed yet, or null when it can. */
  blockedBy: string | null;
  /** The order is being placed (retries included) or paid. */
  busy: boolean;
  /** The last attempt's error, or null. */
  error: unknown;
  cartLines: readonly CartLine[] | undefined;
  onPlace: () => void;
}

/**
 * "Buat pesanan & bayar" (Bab 11 artikel 04), with what went wrong.
 *
 * The button stays a real, focusable button while something is missing,
 * disabled with the reason under it (aria-describedby), so a screen reader
 * user hears why. While the order is placed (and retried, with the same
 * key) it says so; an error takes the focus (FormAlert), because the
 * disabled button just lost it.
 */
export function PlaceOrder({
  blockedBy,
  busy,
  error,
  cartLines,
  onPlace,
}: PlaceOrderProps) {
  const reasonId = useId();
  const problems = checkoutProblems(error);
  // A new object per error, so FormAlert moves the focus for each failure
  // (it compares the object, see FormAlert), and not on every render.
  const alert = useMemo(
    () =>
      error === null || error === undefined || checkoutProblems(error) !== null
        ? undefined
        : { message: checkoutErrorMessage(error) },
    [error],
  );

  return (
    <div className="grid gap-3 border-t border-border pt-4">
      {problems !== null && (
        <CheckoutProblemList problems={problems} lines={cartLines} />
      )}
      <FormAlert error={alert} />
      <Button
        className="justify-self-end"
        disabled={blockedBy !== null || busy}
        aria-describedby={blockedBy === null ? undefined : reasonId}
        onClick={onPlace}
      >
        {busy ? "Memproses pesanan…" : "Buat pesanan & bayar"}
      </Button>
      {blockedBy !== null && (
        <p id={reasonId} className="text-right text-sm text-muted-foreground">
          {blockedBy}
        </p>
      )}
    </div>
  );
}
