import { PageHeader } from "@/components/PageHeader.tsx";
import { EmptyState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/** /pesanan: the order queue arrives in artikel 06. */
export function OrdersPage() {
  useDocumentTitle("Pesanan — GoShop Admin");
  return (
    <>
      <PageHeader
        title="Pesanan"
        description="Pesanan pembeli, dari yang sudah dibayar sampai selesai."
      />
      <EmptyState>Antrean pesanan belum tersedia.</EmptyState>
    </>
  );
}
