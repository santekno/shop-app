import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";
import { fieldClasses } from "./Input.tsx";

/**
 * A styled native <select>, after shadcn/ui's native-select, as the
 * storefront has it. Chosen over shadcn's Select (a Radix listbox): the
 * browser's own control is keyboard and screen-reader ready, opens the
 * phone's native picker, and needs no JavaScript. The table's filters
 * have a handful of options each; they need nothing more.
 */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return <select className={cn(fieldClasses, "pr-8", className)} {...props} />;
}
