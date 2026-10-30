import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, SubmitEvent } from "react";
import {
  LOW_STOCK_THRESHOLD,
  VARIANT_STOCK_MAX,
  stockLevel,
} from "@goshop/shared";
import type { AdminProduct, AdminVariant } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useQuickStockChange } from "../hooks/useQuickStockChange.ts";
import { saveErrorMessage } from "../product-form.ts";
import { parseStockInput, stockSummary, totalStock } from "../stock.ts";
import type { StockChange } from "../stock.ts";
import { StockBadge } from "./StockBadge.tsx";

/** 1250 → "1.250". */
const formatCount = (value: number) => value.toLocaleString("id-ID");

/** "+5" or "−3", for the sentences that show a difference. */
const formatDifference = (value: number) =>
  `${value < 0 ? "−" : "+"}${formatCount(Math.abs(value))}`;

/**
 * "Stok" on the edit page (Bab 12 artikel 05): every sellable variant's
 * stock as the server has it, with its badge, and "Ubah stok" to change
 * one without walking through the product form.
 *
 * It reads the page's product query, not the form, so it always shows the
 * server's numbers (refetched when the window regains the focus, and
 * after every change). One variant is edited at a time, in place, under
 * its row; its button says so with `aria-expanded`. Closing the editor
 * (Batal, Escape, a save) gives the focus back to that button; a variant
 * the API says is archived gives it to the heading, before the refetch
 * removes its row (and its button) from under the focus.
 */
export function StockPanel({ product }: { product: AdminProduct }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const summary = stockSummary(product.variants);

  const close = (variantId: string, message?: string, gone = false) => {
    setEditing(null);
    if (message !== undefined) setStatus(message);
    const button = gone ? undefined : buttons.current.get(variantId);
    if (button === undefined) headingRef.current?.focus();
    else button.focus();
  };

  return (
    <Card as="section" labelledBy={headingId} className="mb-6 grid gap-4">
      <div className="grid gap-1">
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          Stok
        </h2>
        <p className="text-sm text-muted-foreground">
          Total {formatCount(totalStock(product.variants))} unit di{" "}
          {product.variants.length} varian
          {summary.out > 0 && `, ${summary.out} habis`}
          {summary.low > 0 &&
            `, ${summary.low} menipis (${LOW_STOCK_THRESHOLD} atau kurang)`}
          . Ubah stok satu varian di sini tanpa membuka formulir: server
          menghitungnya dari stok saat itu, jadi pembelian yang terjadi
          sementara tidak tertimpa.
        </p>
      </div>

      <p role="status" className="text-sm empty:hidden">
        {status}
      </p>

      <ul className="grid divide-y divide-border">
        {product.variants.map((variant) => {
          const open = editing === variant.id;
          const editorId = `${headingId}-${variant.id}`;
          return (
            <li key={variant.id} className="grid gap-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="grid min-w-0">
                  <span className="font-medium break-words">
                    {variant.name}
                  </span>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {variant.sku}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StockBadge level={stockLevel(variant.stock)} />
                  <span className="min-w-12 text-right font-medium tabular-nums">
                    {formatCount(variant.stock)}
                    <span className="sr-only"> unit</span>
                  </span>
                  <Button
                    ref={(element) => {
                      if (element === null) buttons.current.delete(variant.id);
                      else buttons.current.set(variant.id, element);
                    }}
                    variant="outline"
                    size="sm"
                    aria-expanded={open}
                    aria-controls={open ? editorId : undefined}
                    onClick={() => {
                      setStatus("");
                      setEditing(open ? null : variant.id);
                    }}
                  >
                    Ubah stok <span className="sr-only">{variant.name}</span>
                  </Button>
                </div>
              </div>
              {open && (
                <StockEditor
                  id={editorId}
                  productId={product.id}
                  variant={variant}
                  onClose={(message, gone) => {
                    close(variant.id, message, gone);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

interface StockEditorProps {
  id: string;
  productId: string;
  /** The variant as the server has it now (it updates while open). */
  variant: AdminVariant;
  /**
   * Closes the editor; `message` is announced in the panel's status.
   * `gone`: the variant was archived, its row is about to disappear.
   */
  onClose: (message?: string, gone?: boolean) => void;
}

/** The stock moved under a count: what the seller saw, what is there now. */
interface Moved {
  expected: number;
  current: number;
  wanted: number;
}

/**
 * One variant's quick stock change, in two ways (see `StockChange`), each
 * one POST to the API's stock adjustment:
 *
 * - "Tambah atau kurangi" (the default): a difference, for deliveries
 *   and damage (`{ delta }`). The API adds it to the stock as it is then.
 * - "Setel jumlah": a count, after counting the shelf (`{ set, expected }`).
 *   Saved only if the stock is still the one shown when the editor opened
 *   (`expected`); if a sale or a cancellation moved it (409 STOCK_CHANGED,
 *   with the stock now), the editor says by how much and the seller
 *   picks: their count anyway (checked again against the stock now), or
 *   their difference as a delta.
 */
function StockEditor({ id, productId, variant, onClose }: StockEditorProps) {
  const change = useQuickStockChange(productId);
  const inputRef = useRef<HTMLInputElement>(null);
  const movedRef = useRef<HTMLDivElement>(null);
  const modeName = useId();
  const [mode, setMode] = useState<StockChange["mode"]>("add");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string>();
  const [moved, setMoved] = useState<Moved>();
  // The stock on screen when the seller started: what a count is checked
  // against (`expected`). Read once; the row above keeps showing the live
  // number.
  const [seen] = useState(variant.stock);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (moved !== undefined) movedRef.current?.focus();
  }, [moved]);

  const parsed = parseStockInput(mode, raw);
  const preview = parsed.ok
    ? mode === "add"
      ? variant.stock + parsed.value
      : parsed.value
    : undefined;

  const send = (next: StockChange) => {
    setError(undefined);
    setMoved(undefined);
    change.mutate(next, {
      onSuccess: (result) => {
        switch (result.kind) {
          case "saved":
            onClose(
              `Stok ${result.variant.name}: ${formatCount(result.from)} → ${formatCount(result.to)}. Tersimpan.`,
            );
            return;
          case "moved":
            setMoved({
              expected: result.expected,
              current: result.current,
              wanted: result.wanted,
            });
            return;
          case "out-of-range":
            setError(
              result.to < 0
                ? `Stok sekarang ${formatCount(result.current)}; tidak bisa dikurangi sebanyak itu. Belum ada yang tersimpan.`
                : `Stok sekarang ${formatCount(result.current)}; hasilnya melebihi batas ${formatCount(VARIANT_STOCK_MAX)}. Belum ada yang tersimpan.`,
            );
            inputRef.current?.focus();
            return;
          case "gone":
            onClose(
              `Varian ${variant.name} sudah diarsipkan di server; stoknya tidak diubah.`,
              true,
            );
            return;
        }
      },
      onError: (failure) => {
        setError(
          saveErrorMessage(
            failure,
            "Stok belum tersimpan karena kesalahan di server. Coba lagi.",
          ),
        );
        inputRef.current?.focus();
      },
    });
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsed.ok) {
      setError(parsed.message);
      inputRef.current?.focus();
      return;
    }
    send(
      mode === "add"
        ? { mode, variantId: variant.id, amount: parsed.value }
        : {
            mode,
            variantId: variant.id,
            value: parsed.value,
            expected: seen,
          },
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !change.isPending) {
      event.stopPropagation();
      onClose();
    }
  };

  const difference = moved === undefined ? 0 : moved.wanted - moved.expected;
  const combined = moved === undefined ? 0 : moved.current + difference;

  return (
    // A group named by the variant; Escape anywhere in it closes it.
    <div
      id={id}
      role="group"
      aria-label={`Ubah stok ${variant.name}`}
      onKeyDown={onKeyDown}
      className="grid gap-3 rounded-md border border-input p-3"
    >
      <form noValidate onSubmit={submit} className="grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Cara mengubah</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(
              [
                ["add", "Tambah atau kurangi"],
                ["set", "Setel jumlah"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={modeName}
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    setError(undefined);
                    setMoved(undefined);
                  }}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="max-w-xs">
          <TextField
            ref={inputRef}
            label={mode === "add" ? "Jumlah perubahan" : "Stok baru"}
            inputMode={mode === "add" ? "text" : "numeric"}
            autoComplete="off"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              if (error !== undefined) setError(undefined);
            }}
            hint={
              mode === "add"
                ? "Misalnya 20 untuk barang masuk, -2 untuk barang rusak. Dihitung dari stok terbaru saat disimpan."
                : "Hasil hitung fisik. Jika stok berubah sejak Anda mulai, Anda diminta memilih."
            }
            error={error}
          />
        </div>

        <p className="text-sm" aria-live="polite">
          {preview === undefined
            ? `Stok sekarang ${formatCount(variant.stock)}.`
            : `Stok sekarang ${formatCount(variant.stock)}, menjadi ${formatCount(preview)}.`}
        </p>

        {moved === undefined && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={change.isPending}>
              {change.isPending ? "Menyimpan…" : "Simpan stok"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={change.isPending}
              onClick={() => {
                onClose();
              }}
            >
              Batal
            </Button>
          </div>
        )}
      </form>

      {moved !== undefined && (
        <div
          ref={movedRef}
          role="alert"
          tabIndex={-1}
          className="grid gap-3 rounded-md border border-destructive p-3"
        >
          <p className="text-sm">
            Stok {variant.name} berubah dari {formatCount(moved.expected)}{" "}
            menjadi {formatCount(moved.current)} sejak Anda mulai (pembelian,
            pembatalan pesanan, atau admin lain). Belum ada yang tersimpan. Anda
            ingin menyetel {formatCount(moved.wanted)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={change.isPending}
              onClick={() => {
                send({
                  mode: "set",
                  variantId: variant.id,
                  value: moved.wanted,
                  expected: moved.current,
                });
              }}
            >
              Tetap setel {formatCount(moved.wanted)}
            </Button>
            {difference !== 0 &&
              combined >= 0 &&
              combined <= VARIANT_STOCK_MAX && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={change.isPending}
                  onClick={() => {
                    send({
                      mode: "add",
                      variantId: variant.id,
                      amount: difference,
                    });
                  }}
                >
                  Pakai {formatCount(moved.current)}{" "}
                  {formatDifference(difference)} = {formatCount(combined)}
                </Button>
              )}
            <Button
              variant="ghost"
              size="sm"
              disabled={change.isPending}
              onClick={() => {
                onClose();
              }}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
