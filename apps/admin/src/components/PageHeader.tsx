import type { ReactNode } from "react";

interface PageHeaderProps {
  /** The page's name: its one <h1>. */
  title: string;
  /** One sentence under the title: what the page is for. */
  description?: ReactNode;
}

/**
 * The top of every dashboard page: its <h1> and what it is for.
 *
 * tabIndex={-1} lets useRouteFocus give the heading the focus after a
 * navigation, so a screen reader reads the new page's name; Tab never
 * stops on it.
 */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-6 grid gap-1">
      <h1 tabIndex={-1}>{title}</h1>
      {description !== undefined && (
        <p className="text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
