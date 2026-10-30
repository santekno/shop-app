import { useState } from "react";
import { useNavigate } from "react-router";
import { PageHeader } from "@/components/PageHeader.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useCreateProduct } from "../hooks/useProductMutations.ts";
import { emptyProductForm } from "../product-form.ts";
import type { ProductPageState } from "./ProductEditPage.tsx";
import { ProductForm } from "./ProductForm.tsx";

/**
 * /produk/baru: a new product, in three steps.
 *
 * After the save the seller lands on the new product's own page
 * (/produk/<id>), not back on the table: the next thing a new product
 * needs is its photos, which can only be added once it exists (artikel
 * 04), and that page is where they are. `replace`, so Back from there goes
 * to the table rather than to an empty "new product" form, and a reload
 * shows the saved product instead of creating it a second time.
 */
export function ProductCreatePage() {
  useDocumentTitle("Tambah produk — GoShop Admin");
  const navigate = useNavigate();
  const create = useCreateProduct();
  // Read once: the form takes its starting values when it mounts.
  const [defaultValues] = useState(emptyProductForm);

  return (
    <>
      <PageHeader
        title="Tambah produk"
        description="Produk baru disimpan sebagai draf, kecuali Anda memilih status lain."
      />
      <ProductForm
        mode="create"
        defaultValues={defaultValues}
        cancelTo="/produk"
        onSave={(body) => create.mutateAsync(body)}
        onSaved={(product) => {
          const state: ProductPageState = {
            notice: `Produk “${product.name}” tersimpan. Tambahkan fotonya di halaman ini.`,
          };
          void navigate(`/produk/${product.id}`, { replace: true, state });
        }}
      />
    </>
  );
}
