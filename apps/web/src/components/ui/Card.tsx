import type { ReactNode } from "react";

interface CardProps {
  /** The element to render: a plain box, a page section, or one item. */
  as?: "div" | "section" | "article";
  className?: string;
  /** The id of the heading that names the card, for screen readers. */
  labelledBy?: string;
  /** Whatever goes inside: React passes the nested JSX as this prop. */
  children: ReactNode;
}

/**
 * The bordered box every panel of the storefront sits in.
 *
 * Card does not know what it holds: the caller nests any JSX inside
 * <Card>…</Card>, and it arrives as `children`. That is composition, the
 * React way to reuse layout, instead of one component with a flag for
 * every variant.
 */
export function Card({
  as: Element = "div",
  className,
  labelledBy,
  children,
}: CardProps) {
  // A capitalised variable can be used as a tag: <Element> renders
  // <div>, <section> or <article>.
  const classes = className === undefined ? "card" : `card ${className}`;
  return (
    <Element className={classes} aria-labelledby={labelledBy}>
      {children}
    </Element>
  );
}
