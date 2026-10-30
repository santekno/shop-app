import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { PRODUCT_VARIANTS_MAX } from "@goshop/shared";
import type { ProductInput, ProductWrite } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useProductField } from "../hooks/useProductField.ts";
import { emptyVariant } from "../product-form.ts";
import type { ProductFormMode } from "./ProductForm.tsx";

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
 * Artikel 05 builds on this list (stock management, the low-stock badge,
 * what to do when the API answers 409).
 */
export function ProductVariantsStep({ mode }: { mode: ProductFormMode }) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput, unknown, ProductWrite>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variants",
    keyName: "key",
  });
  const addRef = useRef<HTMLButtonElement>(null);
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
          " Varian yang dihapus dari daftar diarsipkan saat disimpan: riwayat pesanan tetap utuh, dan SKU-nya tidak dapat dipakai lagi."}
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
              canRemove={fields.length > 1}
              onRemove={() => {
                remove(index);
                addRef.current?.focus();
              }}
            />
          </li>
        ))}
      </ol>

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
function VariantFieldset({ index, canRemove, onRemove }: VariantFieldsetProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<ProductInput, unknown, ProductWrite>();
  const field = useProductField();
  const name = useWatch({ control, name: `variants.${index}.name` });
  const fieldErrors = errors.variants?.[index];
  const label = `Varian ${index + 1}`;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
      <legend className="px-1 font-medium">
        {label}
        {name.trim() !== "" && `: ${name.trim()}`}
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
          error={fieldErrors?.stock?.message}
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
