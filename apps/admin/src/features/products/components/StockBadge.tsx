import { LOW_STOCK_THRESHOLD } from "@goshop/shared";
import type { StockLevel } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";

interface StockBadgeProps {
  level: StockLevel;
  /**
   * Where "menipis" starts, for the `title`. The table passes the API's
   * `low_stock_threshold`; the edit page, which no response tells, the
   * shared LOW_STOCK_THRESHOLD (the default).
   */
  threshold?: number | undefined;
}

/**
 * A stock warning as a badge: "Stok habis" (filled) for nothing left,
 * "Stok menipis" (outlined) for `threshold` units or fewer, and nothing
 * at all for enough. The word carries the meaning, the colour only
 * repeats it; `title` says where "menipis" starts, for a pointer.
 *
 * It takes a level, not a number: a variant's level is `stockLevel(stock)`,
 * while a product row's comes from the API's totals (`productStockLevel`).
 */
export function StockBadge({
  level,
  threshold = LOW_STOCK_THRESHOLD,
}: StockBadgeProps) {
  switch (level) {
    case "out":
      return <Badge variant="danger">Stok habis</Badge>;
    case "low":
      return (
        <Badge variant="destructive" title={`${threshold} unit atau kurang`}>
          Stok menipis
        </Badge>
      );
    case "ok":
      return null;
  }
}
