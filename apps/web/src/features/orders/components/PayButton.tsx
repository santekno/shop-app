import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { usePayOrder } from "../hooks/usePayOrder.ts";
import type { PayableOrder } from "../hooks/usePayOrder.ts";
import { payErrorMessage } from "../payment-errors.ts";

interface PayButtonProps {
  order: PayableOrder;
  children?: string;
  /** Replace the history entry instead of adding one (see usePayOrder). */
  replace?: boolean;
}

/**
 * "Bayar sekarang" for an unpaid order: on the payment page (artikel
 * 04–05) and the order's page (artikel 06). The error, when the payment
 * could not be started, appears under the button and takes the focus
 * (the button was disabled while it ran, and the browser moved the focus
 * away from it).
 */
export function PayButton({
  order,
  children = "Bayar sekarang",
  replace = false,
}: PayButtonProps) {
  const { pay, isPending, error } = usePayOrder();
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error !== null) alert.current?.focus();
  }, [error]);

  return (
    <div className="grid justify-items-start gap-2">
      {/* Only while the request runs: a second "pay" for the same order
          answers the same open payment, so a double click after it costs
          a request, never a second payment. */}
      <Button
        disabled={isPending}
        onClick={() => {
          pay(order, { replace });
        }}
      >
        {isPending ? "Membuka pembayaran…" : children}
      </Button>
      {error !== null && (
        <p ref={alert} role="alert" tabIndex={-1} className="text-destructive">
          {payErrorMessage(error)}
        </p>
      )}
    </div>
  );
}
