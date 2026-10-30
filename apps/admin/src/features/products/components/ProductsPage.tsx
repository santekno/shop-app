import { PageHeader } from "@/components/PageHeader.tsx";
import { EmptyState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/** /produk: the products table arrives in artikel 02. */
export function ProductsPage() {
  useDocumentTitle("Produk — GoShop Admin");
  return (
    <>
      <PageHeader
        title="Produk"
        description="Semua produk toko, termasuk draf dan yang diarsipkan."
      />
      <EmptyState>Daftar produk belum tersedia.</EmptyState>
    </>
  );
}
