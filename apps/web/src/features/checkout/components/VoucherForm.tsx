import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  formatRupiah,
  isApiError,
  previewCheckout,
  voucherSchema,
} from "@goshop/shared";
import type {
  AppliedVoucher,
  CheckoutPreviewRequest,
  VoucherInput,
  VoucherOutput,
} from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { checkoutKeys } from "../api/queries.ts";
import {
  checkoutErrorMessage,
  voucherErrorMessage,
} from "../checkout-errors.ts";

interface VoucherFormProps {
  userId: string;
  cartSignature: string;
  /** The rest of the buyer's choice (address, courier), without a voucher. */
  choice: CheckoutPreviewRequest;
  /** The voucher in use, from the current preview, or null. */
  applied: AppliedVoucher | null;
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** "10%, maks. Rp 25.000" or "Rp 15.000": what a voucher takes off. */
const voucherValue = (voucher: AppliedVoucher): string => {
  if (voucher.kind === "fixed") {
    return formatRupiah({ amount: voucher.value, currency: "IDR" });
  }
  const cap =
    voucher.max_discount === null
      ? ""
      : `, maks. ${formatRupiah(voucher.max_discount)}`;
  return `${String(voucher.value)}%${cap}`;
};

/**
 * Applying and removing a voucher (Bab 11 artikel 03).
 *
 * Applying asks the API first: the form sends a preview with the code
 * (POST /v1/checkout/preview), and only a preview that succeeds makes the
 * code part of the buyer's choice. A code that does not apply
 * (VOUCHER_NOT_APPLICABLE, with its reason) stays in the field with the
 * reason under it, and the summary keeps the totals it had: the buyer is
 * never shown a total with a discount the API refused.
 *
 * The successful preview goes straight into the cache under the key the
 * page will ask for next, so the summary shows it without a second
 * request (preview, quotes and checkout share one rate limit).
 *
 * Focus: after "Pakai" the field disappears and the confirmation takes the
 * focus; after "Hapus voucher" the field comes back and takes it.
 */
export function VoucherForm({
  userId,
  cartSignature,
  choice,
  applied,
  onApply,
  onRemove,
}: VoucherFormProps) {
  const queryClient = useQueryClient();
  const { authApi } = useSession();
  const confirmation = useRef<HTMLParagraphElement>(null);
  // Which element takes the focus once the next render is on screen.
  const focusNext = useRef<"field" | "confirmation" | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    reset,
    formState: { errors },
  } = useForm<VoucherInput, unknown, VoucherOutput>({
    resolver: zodResolver(voucherSchema),
    defaultValues: { voucher_code: "" },
  });

  const apply = useMutation({
    mutationFn: (code: string) =>
      previewCheckout(authApi, { ...choice, voucher_code: code }),
    onSuccess: (preview, code) => {
      queryClient.setQueryData(
        checkoutKeys.preview(userId, cartSignature, {
          ...choice,
          voucher_code: code,
        }),
        preview,
      );
      focusNext.current = "confirmation";
      reset();
      onApply(code);
    },
    onError: (error) => {
      if (isApiError(error, "VOUCHER_NOT_APPLICABLE")) {
        setError(
          "voucher_code",
          { type: "server", message: voucherErrorMessage(error) },
          { shouldFocus: true },
        );
        return;
      }
      setError("root.server", { message: checkoutErrorMessage(error) });
    },
  });

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "confirmation") confirmation.current?.focus();
    if (target === "field") setFocus("voucher_code");
  }, [applied, setFocus]);

  if (applied !== null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
        <p ref={confirmation} tabIndex={-1} role="status">
          Voucher <strong>{applied.code}</strong> dipakai (
          {voucherValue(applied)}).
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            focusNext.current = "field";
            onRemove();
          }}
        >
          Hapus voucher
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2"
      noValidate
      aria-label="Voucher"
      onSubmit={(event) =>
        void handleSubmit(({ voucher_code: code }) => {
          apply.mutate(code);
        })(event)
      }
    >
      <div className="flex items-end gap-2">
        <TextField
          label="Kode voucher"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          error={errors.voucher_code?.message}
          {...register("voucher_code")}
        />
        <Button type="submit" variant="outline" disabled={apply.isPending}>
          {apply.isPending ? "Memeriksa…" : "Pakai"}
        </Button>
      </div>
      <FormAlert error={errors.root?.server} />
    </form>
  );
}
