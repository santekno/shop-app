import { useFormContext, useWatch } from "react-hook-form";
import { toProductSlug } from "@goshop/shared";
import type { ProductInput, ProductWrite } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Field } from "@/components/ui/Field.tsx";
import { NativeSelect } from "@/components/ui/NativeSelect.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { Textarea } from "@/components/ui/Textarea.tsx";
import { useCategoryOptions } from "../hooks/useCategoryOptions.ts";
import { useProductField } from "../hooks/useProductField.ts";
import { STATUS_OPTIONS } from "../product-table-params.ts";
import type { ProductFormMode } from "./ProductForm.tsx";

/** Indents a child category in a native <select>, which ignores CSS padding. */
const indent = (depth: number) => "   ".repeat(depth);

/**
 * Step 1, "Info dasar": name, slug, category, status and description.
 *
 * The slug follows the name while a new product is being written ("Kaos
 * Polos Hitam" → "kaos-polos-hitam"), until the seller edits the slug
 * itself: React Hook Form's `dirtyFields.slug` says so, and it survives a
 * trip to another step and back, which local state in this component
 * would not. Editing a product never changes its slug by itself: the slug
 * is the product's address in the storefront, and links to it would stop
 * working.
 */
export function ProductInfoStep({ mode }: { mode: ProductFormMode }) {
  const {
    setValue,
    getFieldState,
    setFocus,
    control,
    formState: { errors, dirtyFields },
  } = useFormContext<ProductInput, unknown, ProductWrite>();
  const field = useProductField();
  const categories = useCategoryOptions();
  const options = categories.data ?? [];
  const categoryId = useWatch({ control, name: "category_id" });
  // A product's category that is not in the list (deleted since): keep it
  // selectable, so the menu does not claim "Pilih kategori" while the
  // product has one.
  const unknownCategory =
    categoryId !== "" &&
    categories.isSuccess &&
    !options.some((option) => option.id === categoryId);
  const slugFollowsName = mode === "create" && dirtyFields.slug !== true;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextField
          label="Nama produk"
          autoComplete="off"
          error={errors.name?.message}
          {...field("name", {
            onChange: (event) => {
              if (!slugFollowsName) return;
              setValue("slug", toProductSlug(event.target.value), {
                // A slug shown as wrong is checked again with its new value.
                shouldValidate: getFieldState("slug").invalid,
              });
            },
          })}
        />
      </div>

      <div className="sm:col-span-2">
        <TextField
          label="Slug"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          hint={
            mode === "create"
              ? "Alamat produk di toko. Dibuat dari nama; ubah bila perlu (huruf kecil, angka, tanda hubung)."
              : "Alamat produk di toko. Mengubahnya membuat tautan lama ke produk ini tidak berfungsi lagi."
          }
          error={errors.slug?.message}
          {...field("slug")}
        />
      </div>

      <Field
        label="Kategori"
        error={errors.category_id?.message}
        hint={
          categories.isError ? (
            <>
              Kategori tidak dapat dimuat.{" "}
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  // This hint (and its button) goes while the categories
                  // load again: the focus goes to the select it is about.
                  setFocus("category_id");
                  void categories.refetch();
                }}
              >
                Coba lagi
              </Button>
            </>
          ) : undefined
        }
      >
        {(controlProps) => (
          // `value` from useWatch: the categories arrive after the select
          // is on screen, and a select only shows a value it has an
          // option for. Controlled, it shows the product's category as
          // soon as its option exists.
          <NativeSelect
            {...controlProps}
            {...field("category_id")}
            value={categoryId}
          >
            <option value="">Pilih kategori…</option>
            {categories.isPending && (
              <option disabled value="memuat">
                Memuat kategori…
              </option>
            )}
            {unknownCategory && (
              <option value={categoryId}>Kategori tidak dikenal</option>
            )}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {indent(option.depth)}
                {option.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <Field
        label="Status"
        error={errors.status?.message}
        hint="Hanya produk Aktif yang tampil di toko."
      >
        {(controlProps) => (
          <NativeSelect {...controlProps} {...field("status")}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <div className="sm:col-span-2">
        <Field
          label="Deskripsi"
          error={errors.description?.message}
          hint="Opsional. Bahan, ukuran, cara merawat: yang ditanyakan pembeli."
        >
          {(controlProps) => (
            <Textarea rows={6} {...controlProps} {...field("description")} />
          )}
        </Field>
      </div>
    </div>
  );
}
