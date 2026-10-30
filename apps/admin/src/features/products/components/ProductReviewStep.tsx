import { useId } from "react";
import { useFormContext } from "react-hook-form";
import { formatRupiah, productSchema, stockLevel } from "@goshop/shared";
import type { ProductInput, ProductWrite, VariantInput } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { useCategoryOptions } from "../hooks/useCategoryOptions.ts";
import { variantsToArchive } from "../product-form.ts";
import { STATUS_OPTIONS } from "../product-table-params.ts";
import type { ProductFormMode } from "./ProductForm.tsx";
import { StockBadge } from "./StockBadge.tsx";

interface ProductReviewStepProps {
  mode: ProductFormMode;
  /** Edit only: the variants as loaded, to list the ones archived on save. */
  loaded: readonly VariantInput[];
  /** "Ubah": back to the step that holds this part. */
  onEdit: (step: number) => void;
}

/** 1250 → "1.250". */
const formatCount = (value: number) => value.toLocaleString("id-ID");

/**
 * Step 3, "Tinjau": the product exactly as it will be sent, before it is.
 *
 * It shows the schema's output, not the raw inputs: "89.000" is already
 * Rp89.000, " kph-m " is already KPH-M, so the seller checks what the shop
 * will hold. The steps before were validated on the way here, so the parse
 * succeeds; should it not, the save itself reports the field.
 */
export function ProductReviewStep({
  mode,
  loaded,
  onEdit,
}: ProductReviewStepProps) {
  const { getValues } = useFormContext<ProductInput, unknown, ProductWrite>();
  const categories = useCategoryOptions();
  const infoId = useId();
  const variantsId = useId();
  const archivedId = useId();
  const values = getValues();
  const parsed = productSchema.safeParse(values);
  const toArchive = variantsToArchive(loaded, values.variants);

  if (!parsed.success) {
    return (
      <p>
        Masih ada isian yang belum benar. Simpan untuk melihat isian mana yang
        perlu diperbaiki.
      </p>
    );
  }
  const product = parsed.data;
  const category = categories.data?.find(
    (option) => option.id === product.category_id,
  );
  const status = STATUS_OPTIONS.find(
    (option) => option.value === product.status,
  );

  return (
    <div className="grid gap-6">
      <section aria-labelledby={infoId} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={infoId}>Info dasar</h3>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              onEdit(0);
            }}
          >
            Ubah <span className="sr-only">info dasar</span>
          </Button>
        </div>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Nama</dt>
          <dd className="break-words">{product.name}</dd>
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="break-all">{product.slug}</dd>
          <dt className="text-muted-foreground">Kategori</dt>
          <dd>{category?.name ?? "—"}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{status?.label ?? product.status}</dd>
          <dt className="text-muted-foreground">Deskripsi</dt>
          <dd className="break-words whitespace-pre-line">
            {product.description === "" ? "—" : product.description}
          </dd>
        </dl>
      </section>

      <section aria-labelledby={variantsId} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={variantsId}>Varian ({product.variants.length})</h3>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              onEdit(1);
            }}
          >
            Ubah <span className="sr-only">varian</span>
          </Button>
        </div>
        {/* A narrow screen scrolls the table in its own box, never the
            page (TableContainer: focusable and named). */}
        <TableContainer aria-labelledby={variantsId}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">SKU</TableHead>
                <TableHead scope="col">Nama</TableHead>
                <TableHead scope="col" className="text-right">
                  Harga
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Stok
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Berat
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((variant) => (
                <TableRow key={variant.sku}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {variant.sku}
                  </TableCell>
                  <TableCell>{variant.name}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatRupiah({ amount: variant.price, currency: "IDR" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      <StockBadge level={stockLevel(variant.stock)} />
                      {formatCount(variant.stock)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatCount(variant.weight_grams)} g
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </section>

      {toArchive.length > 0 && (
        <section aria-labelledby={archivedId} className="grid gap-2">
          <h3 id={archivedId}>Diarsipkan saat disimpan ({toArchive.length})</h3>
          <p className="text-sm text-muted-foreground">
            Hilang dari toko dan tidak dapat dikembalikan; riwayat pesanannya
            tetap ada, dan SKU-nya tidak dapat dipakai lagi.
          </p>
          <ul className="grid list-disc gap-1 pl-5">
            {toArchive.map((variant) => (
              <li key={variant.id} className="break-all">
                {variant.name}{" "}
                <span className="font-mono text-xs">({variant.sku})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === "create" && (
        <p className="text-sm text-muted-foreground">
          Foto produk ditambahkan setelah produk tersimpan, di halaman produk
          ini.
        </p>
      )}
    </div>
  );
}
