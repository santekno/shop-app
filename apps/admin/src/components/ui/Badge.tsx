import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * From shadcn/ui's Badge, as the storefront has it (apps/web), with two
 * looks the dashboard adds: `success` (an active product) and `outline`
 * (an archived one). Every look keeps its text in a colour role checked
 * for contrast on the card (index.css), so the colour is never the only
 * thing that carries the meaning: the word is always there.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        destructive: "border-destructive text-destructive",
        muted: "border-border bg-muted text-foreground",
        success: "border-success text-success",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

/** A small label: a status such as "Aktif", or a warning such as "Stok menipis". */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
