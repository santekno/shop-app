import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * shadcn/ui's Breadcrumb, the parts the dashboard uses. Plain markup, no
 * Radix behaviour: a <nav> landmark named "Breadcrumb", an ordered list,
 * and the current page marked with aria-current="page" (a <span>, not a
 * link to the page already on screen).
 *
 * Changed from upstream: the label is Indonesian ("Jejak navigasi"), and
 * BreadcrumbPage is not role="link" with aria-disabled (upstream's choice):
 * a link that goes nowhere is one more thing a screen reader announces.
 */
export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav aria-label="Jejak navigasi" {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

/**
 * A step that is a link. asChild renders the one child (React Router's
 * <Link>) with these classes, so navigation stays client-side.
 */
export function BreadcrumbLink({
  asChild = false,
  className,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean }) {
  const Element = asChild ? Slot : "a";
  return (
    <Element
      className={cn(
        "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
        className,
      )}
      {...props}
    />
  );
}

/** The last step: the page on screen. */
export function BreadcrumbPage({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      aria-current="page"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

/** The chevron between two steps; hidden from screen readers. */
export function BreadcrumbSeparator({
  className,
  ...props
}: ComponentProps<"li">) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      <ChevronRight />
    </li>
  );
}
