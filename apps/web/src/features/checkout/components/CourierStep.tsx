import { useId } from "react";
import { formatRupiah, isApiError } from "@goshop/shared";
import type { ShippingQuote } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { EmptyState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { checkoutErrorMessage } from "../checkout-errors.ts";
import { formatEtd, sameService } from "../shipping.ts";
import type { ShippingChoice } from "../shipping.ts";

interface CourierStepProps {
  /** Whether an address is chosen; the quotes need one. */
  hasAddress: boolean;
  quotes: ShippingQuote[] | undefined;
  /** The quotes' query is waiting for its first answer. */
  loading: boolean;
  /** The quotes' query failed (and is not retrying); `error` says why. */
  error: unknown;
  onRetry: () => void;
  selected: ShippingChoice | null;
  onSelect: (quote: ShippingQuote) => void;
}

/**
 * Step 2 of checkout: the courier service (Bab 11 artikel 02).
 *
 * The quotes come from GET /v1/checkout/shipping-quotes for the chosen
 * address, cheapest first, and the page shows each price exactly as the
 * API sent it. A price is a hint: the API asks the courier again when the
 * order is placed, and the summary (artikel 03) shows the fee it will
 * charge.
 *
 * Two errors look alike and are not: SHIPPING_UNAVAILABLE means no
 * courier serves this postal code (retrying does not help, another
 * address might), UPSTREAM_UNAVAILABLE means the rates service did not
 * answer (try again shortly). Only the second gets a "Coba lagi" button.
 */
export function CourierStep({
  hasAddress,
  quotes,
  loading,
  error,
  onRetry,
  selected,
  onSelect,
}: CourierStepProps) {
  const groupId = useId();

  if (!hasAddress) {
    return <EmptyState>Pilih atau tambahkan alamat dulu.</EmptyState>;
  }
  if (loading) {
    return <LoadingState>Menghitung ongkos kirim…</LoadingState>;
  }
  if (error !== null && error !== undefined) {
    const retryable = !isApiError(
      error,
      "SHIPPING_UNAVAILABLE",
      "CART_EMPTY",
      "VALIDATION_FAILED",
    );
    return (
      <div role="alert" className="grid justify-items-start gap-2">
        <p className="text-destructive">{checkoutErrorMessage(error)}</p>
        {retryable && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }
  if (quotes === undefined || quotes.length === 0) {
    return (
      <EmptyState>
        Belum ada kurir untuk alamat ini. Pilih alamat lain.
      </EmptyState>
    );
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">Pilih layanan kurir</legend>
      {quotes.map((quote) => {
        const id = `${groupId}-${quote.courier}-${quote.service}`;
        return (
          <label
            key={`${quote.courier}:${quote.service}`}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 has-checked:border-primary has-checked:bg-accent"
          >
            <input
              id={id}
              type="radio"
              name={`${groupId}-courier`}
              checked={selected !== null && sameService(selected, quote)}
              onChange={() => {
                onSelect(quote);
              }}
              className="mt-1 size-4 accent-primary"
            />
            <span className="grid grow gap-0.5">
              <span className="font-medium">
                {quote.courier_name} {quote.service_name}
              </span>
              <span className="text-sm text-muted-foreground">
                Estimasi {formatEtd(quote.etd)}
              </span>
            </span>
            <span className="font-semibold tabular-nums">
              {formatRupiah(quote.price)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
