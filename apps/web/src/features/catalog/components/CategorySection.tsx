import { Link } from "react-router";
import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { catalogSearch } from "../catalog-filters.ts";
import type { CatalogFilters } from "../catalog-filters.ts";
import { useCategoryTree } from "../hooks/useCategoryTree.ts";
import { CategoryTree } from "./CategoryTree.tsx";

interface CategorySectionProps {
  /** The catalog's current filters: a category link keeps the others. */
  filters: CatalogFilters;
}

/** The category list, with its loading, error and empty states. */
export function CategorySection({ filters }: CategorySectionProps) {
  // `status` is about the data: "pending" (none yet), "error" or
  // "success". `isFetching` is about the network: a request is running,
  // which also happens while old data or an old error is on screen.
  const { data: tree, status, error, isFetching, refetch } = useCategoryTree();
  // Choosing a category keeps the search text and the sort order.
  const hrefFor = (slug: string | undefined) =>
    `/${catalogSearch({ ...filters, category: slug })}`;

  return (
    <Section title="Kategori">
      {(status === "pending" || (status === "error" && isFetching)) && (
        <LoadingState>Memuat kategori…</LoadingState>
      )}

      {status === "error" && !isFetching && (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      )}

      {status === "success" &&
        (tree.length === 0 ? (
          <EmptyState>Belum ada kategori.</EmptyState>
        ) : (
          <>
            <p className="category-all">
              <Link
                to={hrefFor(undefined)}
                aria-current={
                  filters.category === undefined ? "true" : undefined
                }
              >
                Semua produk
              </Link>
            </p>
            <CategoryTree
              nodes={tree}
              activeSlug={filters.category}
              hrefFor={hrefFor}
            />
          </>
        ))}
    </Section>
  );
}
