import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * shadcn/ui's Skeleton: a grey block in the shape of content still on its
 * way, so the page does not jump when it arrives. It says nothing to a
 * screen reader by itself; the caller puts it inside a role="status"
 * with a text such as "Memuat produk…". The pulse stops for anyone who
 * asked their device for less motion.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
