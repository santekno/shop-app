import type { UseQueryResult } from "@tanstack/react-query";
import { checkoutProblems, isApiError } from "@goshop/shared";
import type {
  CartLine,
  CheckoutPreview,
  CheckoutPreviewRequest,
} from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { LoadingState } from "@/components/ui/StatusMessage.tsx";
import { checkoutErrorMessage } from "../checkout-errors.ts";
import { CheckoutProblemList } from "./CheckoutProblemList.tsx";
import { OrderSummary } from "./OrderSummary.tsx";
import { VoucherForm } from "./VoucherForm.tsx";

interface SummaryStepProps {
  userId: string;
  cartSignature: string;
  cartLines: readonly CartLine[] | undefined;
  /** The buyer's choice without the voucher. */
  choice: CheckoutPreviewRequest;
  voucherCode: string | null;
  onVoucherChange: (code: string | null) => void;
  preview: UseQueryResult<CheckoutPreview>;
}

/**
 * Step 3 of checkout: the order summary and the voucher (Bab 11
 * artikel 03). Everything shown comes from the preview query
 * (POST /v1/checkout/preview for the buyer's current choice).
 *
 * The preview's errors each get their own answer:
 *
 * - CHECKOUT_PROBLEMS: the lines checkout would refuse, and a link to
 *   the cart page where each one is fixed;
 * - VOUCHER_NOT_APPLICABLE for a voucher already in use (the cart changed
 *   under it, or its quota ran out since): why, and "Hapus voucher";
 * - anything else: the reason, and "Coba lagi".
 */
export function SummaryStep({
  userId,
  cartSignature,
  cartLines,
  choice,
  voucherCode,
  onVoucherChange,
  preview,
}: SummaryStepProps) {
  const failed = preview.status === "error" && !preview.isFetching;
  const problems = failed ? checkoutProblems(preview.error) : null;
  const voucherRefused =
    failed && isApiError(preview.error, "VOUCHER_NOT_APPLICABLE");

  return (
    <div className="grid gap-4">
      {preview.status === "pending" && (
        <LoadingState>Menghitung total…</LoadingState>
      )}
      {preview.status === "error" && preview.isFetching && (
        <LoadingState>Menghitung ulang total…</LoadingState>
      )}
      {problems !== null && (
        <CheckoutProblemList problems={problems} lines={cartLines} />
      )}
      {failed && problems === null && (
        <div role="alert" className="grid justify-items-start gap-2">
          <p className="text-destructive">
            {checkoutErrorMessage(preview.error)}
          </p>
          {voucherRefused ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onVoucherChange(null);
              }}
            >
              Hapus voucher
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void preview.refetch();
              }}
            >
              Coba lagi
            </Button>
          )}
        </div>
      )}
      {preview.data !== undefined && (
        <OrderSummary
          preview={preview.data}
          updating={preview.isPlaceholderData || preview.isFetching}
        />
      )}
      {!voucherRefused && (
        <VoucherForm
          userId={userId}
          cartSignature={cartSignature}
          choice={choice}
          applied={
            voucherCode === null ? null : (preview.data?.voucher ?? null)
          }
          onApply={onVoucherChange}
          onRemove={() => {
            onVoucherChange(null);
          }}
        />
      )}
    </div>
  );
}
