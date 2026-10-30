import type { Order } from "@goshop/shared";
import { formatDateTime } from "@/lib/format-date.ts";
import { cn } from "@/lib/utils.ts";
import { timelineSteps } from "../order-timeline.ts";

/**
 * The timeline as an ordered list: the order of the steps is the
 * meaning, so a screen reader hears "list, 5 items". The current step has
 * aria-current="step"; "selesai" and "belum" are words, not only a dot's
 * colour.
 */
export function OrderTimeline({ order }: { order: Order }) {
  return (
    <ol className="grid gap-3">
      {timelineSteps(order).map((step) => (
        <li
          key={step.key}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex gap-3"
        >
          <span
            aria-hidden="true"
            className={cn(
              "mt-1.5 size-2.5 shrink-0 rounded-full border-2",
              step.state === "upcoming"
                ? "border-input"
                : "border-primary bg-primary",
            )}
          />
          <span className="grid">
            <span
              className={cn(
                step.state === "current" && "font-semibold",
                step.state === "upcoming" && "text-muted-foreground",
              )}
            >
              {step.label}
              <span className="sr-only">
                {step.state === "done"
                  ? " (sudah)"
                  : step.state === "current"
                    ? " (sekarang)"
                    : " (belum)"}
              </span>
            </span>
            {step.at !== null && (
              <span className="text-sm text-muted-foreground">
                {formatDateTime(step.at)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
