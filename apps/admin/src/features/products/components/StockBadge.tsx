import { LOW_STOCK_THRESHOLD } from "@goshop/shared";
import type { StockLevel } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";

/**
 * A stock warning as a badge: "Stok habis" (filled) for nothing left,
 * "Stok menipis" (outlined) for LOW_STOCK_THRESHOLD units or fewer, and
 * nothing at all for enough. The word carries the meaning, the colour only
 * repeats it; `title` says where "menipis" starts, for a pointer.
 *
 * It takes a level, not a number: a variant's level is `stockLevel(stock)`,
 * while a product row's comes from the API's totals (`productStockLevel`).
 */
export function StockBadge({ level }: { level: StockLevel }) {
  switch (level) {
    case "out":
      return <Badge variant="danger">Stok habis</Badge>;
    case "low":
      return (
        <Badge
          variant="destructive"
          title={`${LOW_STOCK_THRESHOLD} unit atau kurang`}
        >
          Stok menipis
        </Badge>
      );
    case "ok":
      return null;
  }
}
