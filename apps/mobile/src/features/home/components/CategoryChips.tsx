import { useQuery } from "@tanstack/react-query";
import { FlatList, Pressable, Text, View } from "react-native";
import type { Category } from "@goshop/shared";

import { SectionHeader } from "@/components/SectionHeader";
import { SectionStatus } from "@/components/SectionStatus";
import { EmptyState } from "@/components/StatusMessage";
import { categoriesQuery } from "@/features/catalog/api/queries";
import { queryView } from "@/lib/query-state";

/**
 * The top-level categories only: the row is a shortcut, the Kategori tab
 * has the whole tree. A parent's filter includes its children's products
 * (the API's rule), so nothing is out of reach. `select` is defined once,
 * outside the component: TanStack Query re-runs a select that changed
 * identity on every render.
 */
const topLevel = (categories: Category[]) =>
  categories.filter((category) => category.parent_id === null);

interface CategoryChipsProps {
  onOpenCategory: (slug: string) => void;
  /** The list around the row pads this much each side; the row bleeds out. */
  bleed: number;
}

/**
 * "Kategori": a horizontal row of chips from GET /v1/categories, the same
 * cache entry the Kategori tab and the catalog's category chip read.
 * States: loading, offline, failed with a retry, and "Belum ada kategori."
 */
export function CategoryChips({ onOpenCategory, bleed }: CategoryChipsProps) {
  const query = useQuery({ ...categoriesQuery(), select: topLevel });
  const view = queryView(query);

  return (
    <View>
      <SectionHeader title="Kategori" />
      {view !== "ready" ? (
        <SectionStatus
          view={view}
          what="kategori"
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : query.data?.length === 0 ? (
        <EmptyState message="Belum ada kategori." />
      ) : (
        <FlatList
          horizontal
          data={query.data}
          keyExtractor={(category) => category.id}
          showsHorizontalScrollIndicator={false}
          // The row reaches the screen's edges; the first chip still
          // starts 16 dp in, as everything else on the screen does.
          style={{ marginHorizontal: -bleed }}
          contentContainerStyle={{ paddingHorizontal: bleed + 6, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              role="button"
              accessibilityLabel={`Kategori ${item.name}`}
              onPress={() => {
                onOpenCategory(item.slug);
              }}
              className="min-h-12 justify-center rounded-full border border-border bg-card px-4 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark"
            >
              <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
