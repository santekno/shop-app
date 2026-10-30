import { formatRupiah } from "@goshop/shared";
import type { Order } from "@goshop/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";

/**
 * The order's lines as they were bought: names, SKUs and prices are the
 * copies made at checkout, so a product renamed or repriced since does
 * not change what this order says. Under them, what the order charges.
 */
export function OrderItemsTable({ order }: { order: Order }) {
  const { totals } = order;
  return (
    <div className="grid gap-4">
      <TableContainer aria-label="Barang yang dipesan">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Harga</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="min-w-40">
                  <span className="block font-medium">{item.product_name}</span>
                  <span className="block text-muted-foreground">
                    {item.variant_name}
                  </span>
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {item.sku}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatRupiah(item.unit_price)}
                </TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatRupiah(item.line_total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatRupiah(totals.subtotal)}</dd>
        {totals.discount.amount > 0 && (
          <>
            <dt>
              Diskon
              {order.voucher_code !== null && (
                <>
                  {" "}
                  (voucher{" "}
                  <span className="font-mono">{order.voucher_code}</span>)
                </>
              )}
            </dt>
            <dd className="text-right">−{formatRupiah(totals.discount)}</dd>
          </>
        )}
        <dt>
          Ongkos kirim ({(totals.weight_grams / 1000).toLocaleString("id-ID")}{" "}
          kg)
        </dt>
        <dd className="text-right">{formatRupiah(totals.shipping_fee)}</dd>
        <dt className="border-t border-border pt-1 font-semibold">Total</dt>
        <dd className="border-t border-border pt-1 text-right font-semibold">
          {formatRupiah(totals.total)}
        </dd>
      </dl>
    </div>
  );
}
