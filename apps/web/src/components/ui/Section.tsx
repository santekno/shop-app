import { useId } from "react";
import type { ReactNode } from "react";
import { Card } from "./Card.tsx";

interface SectionProps {
  title: string;
  className?: string;
  children: ReactNode;
}

/**
 * A titled panel of a page: a Card rendered as <section>, named by its
 * heading. Section composes Card the same way callers compose Section.
 */
export function Section({ title, className, children }: SectionProps) {
  // useId gives an id that is unique on the page, so two sections never
  // point aria-labelledby at the same heading.
  const headingId = useId();
  return (
    <Card as="section" className={className} labelledBy={headingId}>
      <h2 id={headingId} className="mb-3">
        {title}
      </h2>
      {children}
    </Card>
  );
}
