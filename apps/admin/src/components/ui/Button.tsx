import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * The button's looks, as variants. cva (class-variance-authority) maps
 * props to class lists, so <Button variant="outline" size="sm"> picks the
 * classes here and nowhere else.
 *
 * From shadcn/ui's Button (new-york style), changed for GoShop:
 * - the focus indicator is an outline (index.css, :focus-visible), not
 *   shadcn's box-shadow ring: an outline survives Windows' forced-colours
 *   mode, a shadow does not;
 * - sizes are a little taller (h-10, icon size-10): easier to hit on a
 *   phone;
 * - the variants GoShop does not use (secondary) are gone.
 *
 * cva writes the variant's classes first and the size's after them, and
 * cn (tailwind-merge) keeps the later of two clashing classes. So a
 * class that must beat the size goes in compoundVariants, which cva
 * writes last: that is how the link variant drops the box.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        icon: "size-10",
      },
    },
    compoundVariants: [
      // A link has no button box, whatever the size says.
      { variant: "link", className: "h-auto px-0" },
    ],
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /**
     * Render the one child element (a <Link>, say) with the button's
     * classes instead of a <button>: Radix's Slot merges the props into
     * it. A link that looks like a button is still a link.
     */
    asChild?: boolean;
  };

/** shadcn/ui's Button: a <button> (type="button" unless set) with variants. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
  return (
    <button
      // A <button> inside a <form> submits it unless told otherwise; most
      // of ours are not submit buttons, so "button" is the safer default.
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
