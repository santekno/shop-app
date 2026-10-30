import { PageHeader } from "@/components/PageHeader.tsx";
import { EmptyState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/** /laporan: the sales chart arrives in artikel 07. */
export function ReportsPage() {
  useDocumentTitle("Laporan — GoShop Admin");
  return (
    <>
      <PageHeader
        title="Laporan"
        description="Pendapatan dan jumlah pesanan per periode."
      />
      <EmptyState>Laporan penjualan belum tersedia.</EmptyState>
    </>
  );
}
