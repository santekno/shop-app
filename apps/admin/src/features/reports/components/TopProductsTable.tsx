import { formatRupiah } from "@goshop/shared";
import type { SalesReport } from "@goshop/shared";
import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { EmptyState } from "@/components/ui/StatusMessage.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { formatCount } from "../report-format.ts";

/**
 * The range's five best-selling products by revenue. A table, not a
 * chart: five names and two numbers read faster as text, and a name is a
 * link to the product. Products with the same revenue share a rank (the
 * API's `rank`), so the column shows it instead of the row's position.
 */
export function TopProductsTable({
  report,
  headingId,
}: {
  report: SalesReport;
  headingId: string;
}) {
  return (
    <Card as="section" labelledBy={headingId} className="grid gap-3">
      <div>
        <h2 id={headingId}>Produk terlaris</h2>
        <p className="text-sm text-muted-foreground">
          Lima produk dengan pendapatan terbesar. Pendapatan produk adalah harga
          barangnya, sebelum voucher dan tanpa ongkos kirim, sehingga jumlahnya
          tidak sama dengan pendapatan pesanan.
        </p>
      </div>
      {report.top_products.length === 0 ? (
        <EmptyState>Belum ada produk terjual pada rentang ini.</EmptyState>
      ) : (
        <TableContainer aria-label="Produk terlaris">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Terjual</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.top_products.map((product) => (
                <TableRow key={product.product_id}>
                  <TableCell className="text-right tabular-nums">
                    {product.rank}
                  </TableCell>
                  <th
                    scope="row"
                    className="min-w-40 px-3 py-2 text-left font-normal"
                  >
                    <Link to={`/produk/${product.product_id}`}>
                      {product.name}
                    </Link>
                  </th>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatCount(product.units)} unit
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatRupiah(product.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}
