import { useId, useRef } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { formatRupiah } from "@goshop/shared";
import type { CartLine } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { productPath } from "@/features/product/paths.ts";
import { cartLineErrorMessage } from "../cart-errors.ts";
import {
  LINE_MAX_QUANTITY,
  useChangeCartLine,
} from "../hooks/useChangeCartLine.ts";

/** Why checkout would refuse a line, in the buyer's words. */
const PROBLEM_TEXT = {
  unavailable: "Sudah tidak dijual",
  insufficient_stock: "Stok tidak cukup",
  price_changed: "Harga berubah",
} as const;

interface CartLineItemProps {
  line: CartLine;
  /** Called once the API has removed the line (CartPage moves the focus). */
  onRemoved: (line: CartLine) => void;
}

/**
 * One line of the cart page: the product, its quantity stepper, its total,
 * and what to do about a problem the API reports on it.
 *
 * `line.problem` is the API's word on whether checkout would take the line
 * as it is, and each problem has one fix the buyer can make here:
 *
 * - `price_changed`: "Pakai harga baru" saves the same quantity again,
 *   which is how the contract accepts today's price;
 * - `insufficient_stock`: "Ubah jadi N" lowers the quantity to the stock;
 * - `unavailable`: only removing the line helps.
 *
 * The stepper's buttons and the remove button name the product in their
 * accessible names ("Tambah jumlah Kaos Polos, M"): a page with five lines
 * has five "+" buttons, and a screen reader's list of buttons must tell
 * them apart.
 */
export function CartLineItem({ line, onRemoved }: CartLineItemProps) {
  const { change, isPending, isError, error, lastChange } = useChangeCartLine();
  const errorId = useId();
  const labelId = useId();
  const name = `${line.product_name}, ${line.variant_name}`;
  const removing = isPending && lastChange?.kind === "remove";
  // The stock caps the stepper, but never below 1: a line whose stock ran
  // out shows its problem and the remove button instead.
  const max = Math.max(1, Math.min(LINE_MAX_QUANTITY, line.stock));

  const productLink = useRef<HTMLAnchorElement>(null);

  /**
   * A fix for a problem ("Pakai harga baru", "Ubah jadi N"). Once it
   * succeeds the problem, and the button that was pressed, disappear; the
   * focus goes to the line's product link instead of falling to <body>.
   */
  const fixQuantity = (quantity: number) => {
    change(
      { kind: "quantity", variantId: line.variant_id, quantity },
      {
        onSuccess: () => {
          productLink.current?.focus();
        },
      },
    );
  };
  const remove = () => {
    change(
      { kind: "remove", variantId: line.variant_id },
      {
        onSuccess: () => {
          onRemoved(line);
        },
      },
    );
  };

  return (
    // Name above the total on a phone, side by side from sm. cart-line and
    // the one <strong> per line are what the e2e suite reads.
    <li
      className="cart-line flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:justify-between sm:gap-4"
      aria-busy={isPending}
    >
      <div className="grid gap-2">
        <div>
          <Link ref={productLink} href={productPath(line.product_slug)}>
            {line.product_name}
          </Link>
          <p className="mt-0.5 text-muted-foreground">
            {line.variant_name} · {line.quantity} ×{" "}
            {formatRupiah(line.unit_price)}
          </p>
        </div>
        {line.problem !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive" className="badge">
              {PROBLEM_TEXT[line.problem]}
            </Badge>
            {line.problem === "price_changed" && (
              <>
                <span className="text-sm text-muted-foreground">
                  Sebelumnya {formatRupiah(line.price_when_added)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    fixQuantity(line.quantity);
                  }}
                >
                  Pakai harga baru
                </Button>
              </>
            )}
            {line.problem === "insufficient_stock" && line.stock > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  fixQuantity(Math.min(line.stock, LINE_MAX_QUANTITY));
                }}
              >
                Ubah jadi {Math.min(line.stock, LINE_MAX_QUANTITY)}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2"
            role="group"
            aria-labelledby={labelId}
          >
            <span id={labelId} className="sr-only">
              Jumlah {name}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Kurangi jumlah ${name}`}
              disabled={removing || line.quantity <= 1}
              onClick={() => {
                change({ kind: "step", variantId: line.variant_id, delta: -1 });
              }}
            >
              <Minus aria-hidden="true" />
            </Button>
            <output
              className="min-w-[2ch] text-center tabular-nums"
              aria-live="polite"
            >
              {line.quantity}
            </output>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Tambah jumlah ${name}`}
              disabled={removing || line.quantity >= max}
              onClick={() => {
                change({ kind: "step", variantId: line.variant_id, delta: 1 });
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Hapus ${name}`}
            aria-describedby={isError ? errorId : undefined}
            disabled={isPending}
            onClick={remove}
          >
            <Trash2 aria-hidden="true" />
            {removing ? "Menghapus…" : "Hapus"}
          </Button>
        </div>
        {isError && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {cartLineErrorMessage(error)}
          </p>
        )}
      </div>
      <strong>{formatRupiah(line.line_total)}</strong>
    </li>
  );
}
