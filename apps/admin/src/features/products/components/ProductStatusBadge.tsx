import type { AdminProductStatus } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { STATUS_OPTIONS } from "../product-table-params.ts";

/** Each status's look: active stands out, a draft is quiet, archived fades. */
const VARIANT = {
  active: "success",
  draft: "muted",
  archived: "outline",
} as const satisfies Record<AdminProductStatus, string>;

/** A product's status as a badge: "Aktif", "Draf" or "Diarsipkan". */
export function ProductStatusBadge({ status }: { status: AdminProductStatus }) {
  const label =
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
  return <Badge variant={VARIANT[status]}>{label}</Badge>;
}
