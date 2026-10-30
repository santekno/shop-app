import { useState } from "react";
import { Archive } from "lucide-react";
import type { AdminProduct } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.tsx";
import { useArchiveProduct } from "../hooks/useProductMutations.ts";
import { saveErrorMessage } from "../product-form.ts";

interface ArchiveProductButtonProps {
  product: AdminProduct;
  /** After the API archived it and the product was fetched again. */
  onArchived: () => void;
}

/**
 * "Arsipkan" and the question before it (DELETE /v1/admin/products/{id}).
 *
 * The dialog says exactly what happens, because "delete" is what a seller
 * fears: the product leaves the storefront, nothing is deleted, orders
 * keep it, and saving it with another status brings it back. It also
 * warns that unsaved changes in the form are dropped (the form starts over
 * from the archived product). A failure stays in the dialog, with the
 * dialog open, so "Arsipkan" can be pressed again.
 */
export function ArchiveProductButton({
  product,
  onArchived,
}: ArchiveProductButtonProps) {
  const [open, setOpen] = useState(false);
  const archive = useArchiveProduct(product.id);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          archive.reset();
          setOpen(true);
        }}
      >
        <Archive aria-hidden="true" />
        Arsipkan
      </Button>
      <ConfirmDialog
        open={open}
        title={`Arsipkan “${product.name}”?`}
        confirmLabel="Arsipkan"
        destructive
        pending={archive.isPending}
        error={
          archive.isError
            ? saveErrorMessage(
                archive.error,
                "Produk belum diarsipkan karena kesalahan di server. Coba lagi.",
              )
            : undefined
        }
        onCancel={() => {
          setOpen(false);
        }}
        onConfirm={() => {
          archive.mutate(undefined, {
            onSuccess: () => {
              setOpen(false);
              onArchived();
            },
          });
        }}
      >
        <p>
          Produk tidak tampil lagi di toko. Tidak ada yang dihapus: pesanan lama
          tetap mencatatnya, dan menyimpannya lagi dengan status Aktif atau Draf
          memulihkannya.
        </p>
        <p>Perubahan di formulir yang belum disimpan akan dibuang.</p>
      </ConfirmDialog>
    </>
  );
}
