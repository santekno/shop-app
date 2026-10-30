import { Badge } from "@/components/ui/Badge.tsx";
import { useOrderEventsContext } from "../order-events-context.ts";

/** "99+" past 99: the badge stays small, the exact number is not the point. */
const shown = (count: number): string => (count > 99 ? "99+" : String(count));

/**
 * The number of new paid orders on the sidebar's "Pesanan" link, or
 * nothing when there are none. Inside the link, so the link's name says it
 * too: "Pesanan 2 pesanan baru". The number is text, never only a dot.
 */
export function UnreadOrdersBadge() {
  const { unread } = useOrderEventsContext();
  if (unread === 0) return null;
  return (
    <Badge className="ml-auto min-w-5 tabular-nums">
      {shown(unread)}
      <span className="sr-only"> pesanan baru</span>
    </Badge>
  );
}
