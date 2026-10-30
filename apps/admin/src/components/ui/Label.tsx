import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * shadcn/ui's Label, as a plain <label>. shadcn wraps Radix's Label,
 * which adds one thing, not selecting text on double click; a native
 * label already names its field and focuses it on click.
 */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm leading-none font-medium", className)}
      {...props}
    />
  );
}
