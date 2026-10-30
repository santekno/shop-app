import type { ReactNode } from "react";

interface PageHeaderProps {
  /** The page's name: its one <h1>. */
  title: string;
  /** One sentence under the title: what the page is for. */
  description?: ReactNode;
  /** The page's main actions ("Tambah produk"), beside the title. */
  actions?: ReactNode;
}

/**
 * The top of every dashboard page: its <h1> and what it is for.
 *
 * tabIndex={-1} lets useRouteFocus give the heading the focus after a
 * navigation, so a screen reader reads the new page's name; Tab never
 * stops on it.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="grid gap-1">
        <h1 tabIndex={-1}>{title}</h1>
        {description !== undefined && (
          <div className="text-muted-foreground">{description}</div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap gap-2">{actions}</div>
      )}
    </div>
  );
}
