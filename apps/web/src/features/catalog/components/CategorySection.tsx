import { Section } from "@/components/ui/Section.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useCategoryTree } from "../hooks/useCategoryTree.ts";
import { CategoryTree } from "./CategoryTree.tsx";

/** The category list, with its loading, error and empty states. */
export function CategorySection() {
  const { state, reload } = useCategoryTree();

  return (
    <Section title="Kategori">
      {state.status === "loading" && (
        <LoadingState>Memuat kategori…</LoadingState>
      )}

      {state.status === "error" && (
        <ErrorState error={state.error} onRetry={reload} />
      )}

      {state.status === "success" &&
        (state.data.length === 0 ? (
          <EmptyState>Belum ada kategori.</EmptyState>
        ) : (
          <CategoryTree nodes={state.data} />
        ))}
    </Section>
  );
}
