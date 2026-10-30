import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * shadcn/ui's Table: the plain HTML table elements with the dashboard's
 * look. A real <table> (not a grid of <div>s), so a screen reader can
 * announce "row 3 of 20, column Harga" and move cell by cell.
 *
 * One change from shadcn: the scrolling box is its own component,
 * TableContainer, instead of a <div> hidden inside Table, so the caller
 * can name it and make it focusable (see TableContainer).
 */

/**
 * The box a wide table scrolls sideways in, so the page itself never
 * does (a phone shows the table's first columns and scrolls the rest).
 *
 * A box that scrolls must be reachable by keyboard, or someone without a
 * mouse can never see the hidden columns: tabIndex={0} puts it in the Tab
 * order (the arrow keys then scroll it), and role="region" with a label
 * tells a screen reader what it is when it gets the focus.
 */
export function TableContainer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="region"
      tabIndex={0}
      className={cn(
        "relative w-full overflow-x-auto rounded-lg border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      className={cn("w-full caption-bottom border-collapse text-sm", className)}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-b border-border bg-muted/50", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-border hover:bg-muted/40", className)}
      {...props}
    />
  );
}

/** A column header: scope="col" ties it to the cells under it. */
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-11 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export function TableCaption({
  className,
  ...props
}: ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-3 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
