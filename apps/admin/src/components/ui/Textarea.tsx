import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";
import { fieldClasses } from "./Input.tsx";

/** shadcn/ui's Textarea: the fields' look, several lines tall. */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldClasses, "h-auto min-h-28 resize-y", className)}
      {...props}
    />
  );
}
