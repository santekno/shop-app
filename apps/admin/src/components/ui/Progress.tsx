import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * A progress bar: the browser's own <progress>, which is a progressbar
 * to a screen reader without any ARIA of ours (it reads the value as a
 * percentage of `max`). Give it a name with `aria-label` or
 * `aria-labelledby`.
 *
 * The look is set on the element's parts: WebKit and Blink draw a bar
 * (::-webkit-progress-bar) and a value inside it
 * (::-webkit-progress-value), Firefox only the value (::-moz-progress-bar);
 * `appearance-none` turns the platform's own drawing off.
 */
export function Progress({ className, ...props }: ComponentProps<"progress">) {
  return (
    <progress
      className={cn(
        "h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width]",
        className,
      )}
      {...props}
    />
  );
}
