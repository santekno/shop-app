import { useRef, useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  PRODUCT_VARIANTS_MAX,
  VARIANT_STOCK_MAX,
  stockLevel,
} from "@goshop/shared";
import type { ProductInput, ProductWrite, VariantInput } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useProductField } from "../hooks/useProductField.ts";
import { emptyVariant, variantsToArchive } from "../product-form.ts";
import { normalizeMergeValue } from "../product-merge.ts";
import type { ProductFormMode } from "./ProductForm.tsx";
import { StockBadge } from "./StockBadge.tsx";

/** A stock as typed, as a number; undefined while it is not one. */
const typedStock = (value: unknown): number | undefined => {
  const normal = normalizeMergeValue("stock", value);
  return /^\d+$/.test(normal) ? Number(normal) : undefined;
};

/**
 * Step 2, "Varian & harga": the list of variants, each with its SKU, name,
 * price, stock and weight. Price and stock live on the variant, not on the
 * product: "Kaos Polos Hitam" in M and in XL can cost and weigh
 * differently, and each has its own stock.
 *
 * useFieldArray manages the list: `fields` is what to render, with a
 * stable `key` per row (keyName: "key", because a variant has an `id` of
 * its own, the API's, which the form must keep and send back). Adding a
 * variant focuses its first input; removing one moves the focus to "Tambah
 * varian", since the removed row's button is gone.
 *
 * Stock (artikel 05): each variant's legend carries its stock badge
 * ("Stok habis", "Stok menipis") for the number being typed, and an
 * existing variant's stock field says what it was when the form loaded:
 * a checkout may take units before the seller saves, and a save that
 * would write over them is refused (409) and shown side by side. A
 * cancellation can give units back past the form's 1,000,000; such a
 * stock fails the schema, and the field then says why and what to do
 * (write the right number, or lower it with "Ubah stok", which may lower
 * a stock from any height).
 *
 * Removing an existing variant archives it on save, which cannot be
 * undone through the API: its SKU stays taken and an archived variant
 * cannot be written again. So a removed one is listed under the variants
 * as "akan diarsipkan", with "Batalkan" to put it back as loaded, until
 * the save. A variant that is only sold out should keep its place with
 * stock 0: buyers see "habis" and it comes back with the next delivery.
 */
export function ProductVariantsStep({
  mode,
  loaded,
}: {
  mode: ProductFormMode;
  /** Edit only: the variants as the form loaded them. */
  loaded: readonly VariantInput[];
}) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput, unknown, ProductWrite>();
  const { fields, append, insert, remove } = useFieldArray({
    control,
    name: "variants",
    keyName: "key",
  });
  const variants = useWatch({ control, name: "variants" });
  const addRef = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const toArchive = variantsToArchive(loaded, variants);
  const total = variants.reduce(
    (sum, variant) => sum + (typedStock(variant.stock) ?? 0),
    0,
  );
  // The list's own errors: SKU_TAKEN from the API (root.variants), or the
  // schema's "at least one" / "at most 50" (variants.root or variants).
  const listError =
    errors.root?.variants?.message ??
    errors.variants?.root?.message ??
    errors.variants?.message;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Setiap varian adalah barang yang dipilih pembeli, misalnya satu ukuran
        atau satu warna, dengan SKU, harga, stok dan beratnya sendiri. Berat
        dipakai untuk menghitung ongkos kirim.
        {mode === "edit" &&
          " Varian yang dihapus dari daftar diarsipkan saat disimpan: riwayat pesanan tetap utuh, dan SKU-nya tidak dapat dipakai lagi. Jika barangnya hanya habis sementara, isi stok 0 saja."}
      </p>
      <p className="text-sm">
        Total stok:{" "}
        <span className="font-medium tabular-nums">
          {total.toLocaleString("id-ID")}
        </span>{" "}
        dari {variants.length} varian.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {listError !== undefined && (
        <p role="alert" className="text-destructive">
          {listError}
        </p>
      )}

      <ol className="grid gap-4">
        {fields.map((field, index) => (
          <li key={field.key}>
            <VariantFieldset
              index={index}
              loaded={loaded}
              canRemove={fields.length > 1}
              onRemove={() => {
                const removed = variants[index];
                remove(index);
                addRef.current?.focus();
                setAnnouncement(
                  removed?.id === undefined
                    ? "Varian dihapus dari daftar."
                    : "Varian dihapus dari daftar dan akan diarsipkan saat disimpan.",
                );
              }}
            />
          </li>
        ))}
      </ol>

      {toArchive.length > 0 && (
        <section
          aria-label="Varian yang akan diarsipkan"
          className="grid gap-2 rounded-lg border border-destructive p-4"
        >
          <p className="text-sm">
            <strong>Akan diarsipkan saat disimpan</strong> (tidak dapat
            dikembalikan setelah disimpan; SKU-nya tetap terpakai):
          </p>
          <ul className="grid gap-2">
            {toArchive.map((variant) => (
              <li
                key={variant.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="break-all">
                  {variant.name}{" "}
                  <span className="font-mono text-xs">({variant.sku})</span>,
                  stok {String(variant.stock)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fields.length >= PRODUCT_VARIANTS_MAX}
                  onClick={() => {
                    // Back where it was loaded, as it was loaded; insert
                    // focuses its first input.
                    const at = loaded.findIndex(({ id }) => id === variant.id);
                    insert(Math.min(Math.max(at, 0), fields.length), variant);
                    setAnnouncement("Varian dikembalikan ke daftar.");
                  }}
                >
                  <Undo2 aria-hidden="true" />
                  Batalkan{" "}
                  <span className="sr-only">
                    penghapusan varian {variant.name}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid justify-items-start gap-1">
        <Button
          ref={addRef}
          variant="outline"
          disabled={fields.length >= PRODUCT_VARIANTS_MAX}
          onClick={() => {
            append(emptyVariant());
          }}
        >
          <Plus aria-hidden="true" />
          Tambah varian
        </Button>
        {fields.length >= PRODUCT_VARIANTS_MAX && (
          <p className="text-sm text-muted-foreground">
            Paling banyak {PRODUCT_VARIANTS_MAX} varian per produk.
          </p>
        )}
      </div>
    </div>
  );
}

interface VariantFieldsetProps {
  index: number;
  /** The variants as loaded, for an existing one's stock at load time. */
  loaded: readonly VariantInput[];
  /** False for the last variant left: a product needs at least one. */
  canRemove: boolean;
  onRemove: () => void;
}

/**
 * One variant's inputs in a <fieldset>, whose <legend> ("Varian 2: XL")
 * names the group: a screen reader reads it before each input, so five
 * inputs called "Harga" in five variants stay distinguishable.
 *
 * The numbers are text inputs with `inputMode="numeric"`, not
 * type="number": a phone still shows the number pad, but the field takes
 * "89.000" as a seller writes it (the schema reads the dots as thousands)
 * and never turns a scroll of the mouse wheel into a new price.
 */
function VariantFieldset({
  index,
  loaded,
  canRemove,
  onRemove,
}: VariantFieldsetProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput, unknown, ProductWrite>();
  const field = useProductField();
  const name = useWatch({ control, name: `variants.${index}.name` });
  const id = useWatch({ control, name: `variants.${index}.id` });
  const stock = typedStock(
    useWatch({ control, name: `variants.${index}.stock` }),
  );
  const loadedStock =
    id === undefined
      ? undefined
      : typedStock(loaded.find((variant) => variant.id === id)?.stock);
  const fieldErrors = errors.variants?.[index];
  const label = `Varian ${index + 1}`;
  // A cancelled order gives its units back without a cap, so a variant
  // can load with more than the form may send. The schema's "Stok antara
  // 0 dan 1.000.000." would not say why, or what to do.
  const stockError =
    fieldErrors?.stock?.message !== undefined &&
    stock !== undefined &&
    stock > VARIANT_STOCK_MAX &&
    loadedStock !== undefined &&
    loadedStock > VARIANT_STOCK_MAX
      ? `Stok paling banyak ${VARIANT_STOCK_MAX.toLocaleString("id-ID")}. Stok di server melewatinya karena pesanan yang dibatalkan mengembalikan unitnya. Tulis stok yang benar di sini, atau kurangi lewat "Ubah stok" di bagian Stok.`
      : fieldErrors?.stock?.message;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
      <legend className="px-1 font-medium">
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {label}
            {name.trim() !== "" && `: ${name.trim()}`}
          </span>
          {stock !== undefined && <StockBadge level={stockLevel(stock)} />}
        </span>
      </legend>
      <div className="lg:col-span-3">
        <TextField
          label="SKU"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          hint="Kode unik di seluruh toko; disimpan dengan huruf besar."
          error={fieldErrors?.sku?.message}
          {...field(`variants.${index}.sku`)}
        />
      </div>
      <div className="lg:col-span-3">
        <TextField
          label="Nama varian"
          autoComplete="off"
          hint="Yang dipilih pembeli, misalnya M, XL atau Merah."
          error={fieldErrors?.name?.message}
          {...field(`variants.${index}.name`)}
        />
      </div>
      <div className="lg:col-span-2">
        <TextField
          label="Harga (Rp)"
          inputMode="numeric"
          autoComplete="off"
          error={fieldErrors?.price?.message}
          {...field(`variants.${index}.price`)}
        />
      </div>
      <div className="lg:col-span-2">
        <TextField
          label="Stok"
          inputMode="numeric"
          autoComplete="off"
          hint={
            loadedStock === undefined
              ? undefined
              : `Saat dibuka: ${loadedStock.toLocaleString("id-ID")}.`
          }
          error={stockError}
          {...field(`variants.${index}.stock`)}
        />
      </div>
      <div className="lg:col-span-2">
        <TextField
          label="Berat (gram)"
          inputMode="numeric"
          autoComplete="off"
          error={fieldErrors?.weight_grams?.message}
          {...field(`variants.${index}.weight_grams`)}
        />
      </div>
      {canRemove && (
        <div className="sm:col-span-2 lg:col-span-6">
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            Hapus <span className="sr-only">{label}</span>
          </Button>
        </div>
      )}
    </fieldset>
  );
}
