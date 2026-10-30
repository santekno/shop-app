import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * The fields' look, shared by Input and NativeSelect. aria-invalid (set
 * by TextField when the value was refused) turns the border red.
 */
export const fieldClasses =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm";

/**
 * shadcn/ui's Input: a styled <input>, every prop passed through (ref
 * included, a plain prop in React 19). text-base below md keeps iOS
 * Safari from zooming in when the field gets the focus.
 */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}
